import express from "express";
import session from "express-session";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import Stripe from "stripe";
import { getConfig } from "./db.js";
import { createClientService } from "./onboard.js";
import pipelineRouter from "./routes/pipeline.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../client/public");
const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === "production";

// --- Demo credentials ---
const DEMO_USER = {
  email: "demo@agerunway.com",
  password: "runway123",
  name: "Demo Client",
};
const DEMO_EMAILS = new Set([DEMO_USER.email, "demo@ageflowops.com"]);
const demoLoginEnabled = process.env.DEMO_LOGIN === "true";

// --- Owner credentials (OWNER_MODE=true → permanent free, no billing) ---
const ownerModeEnabled = process.env.OWNER_MODE === "true";
const OWNER_USER = {
  email: (process.env.OWNER_EMAIL || "").trim().toLowerCase(),
  password: process.env.OWNER_PASSWORD || "",
};
function isOwnerLogin(email, password) {
  return ownerModeEnabled && OWNER_USER.email && email === OWNER_USER.email && password === OWNER_USER.password;
}

// --- Per-client credentials (CLIENT_EMAIL/CLIENT_PASSWORD on client Render services) ---
const clientModeEnabled = !!process.env.CLIENT_EMAIL;
const CLIENT_USER = {
  email: (process.env.CLIENT_EMAIL || "").trim().toLowerCase(),
  password: process.env.CLIENT_PASSWORD || "",
};
function isClientLogin(email, password) {
  return clientModeEnabled && email === CLIENT_USER.email && password === CLIENT_USER.password;
}

// --- Stripe (only on client deployments) ---
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2024-04-10" })
  : null;

const app = express();
if (isProd) app.set("trust proxy", 1);

// --- Stripe webhook → AUTO-PROVISION a client dashboard on successful payment ---
// MUST be registered BEFORE express.json() so the raw body survives for signature verification.
app.post("/api/runway/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe) return res.status(503).send("Stripe not configured");
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    event = whSecret
      ? stripe.webhooks.constructEvent(req.body, req.headers["stripe-signature"], whSecret)
      : JSON.parse(req.body.toString("utf8")); // unverified — set STRIPE_WEBHOOK_SECRET in prod
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  res.json({ received: true }); // ack immediately; provisioning runs async so Stripe never times out
  if (event.type === "checkout.session.completed") {
    autoProvisionFromSession(event.data.object).catch((e) => console.error("auto-provision failed:", e?.message || e));
  }
});

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "runway-dev-secret-change-in-prod",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd ? "auto" : false,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

function requireAuth(req, res, next) {
  if (!req.session?.user) return res.redirect("/runway-pricing.html");
  next();
}

function isDemoLogin(email, password) {
  return DEMO_EMAILS.has(email) && password === DEMO_USER.password;
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/runway-dashboard.html", requireAuth, (_req, res) => {
  res.sendFile(path.join(publicDir, "runway-dashboard.html"));
});

app.get("/runway-intake.html", requireAuth, (req, res) => {
  if (!req.session?.user?.isOwner) return res.redirect("/runway-dashboard.html");
  res.sendFile(path.join(publicDir, "runway-intake.html"));
});

app.get("/runway_login.html", (_req, res) => {
  res.redirect(301, "/runway-login.html");
});

// --- Login: owner → client → demo (in priority order) ---
app.post("/api/runway/login", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  if (isOwnerLogin(email, password)) {
    const cfg = getConfig();
    req.session.user = { email, name: cfg.clientName || "Omar Anderson", isOwner: true, tier: "owner" };
    return res.redirect("/runway-dashboard.html");
  }

  if (isClientLogin(email, password)) {
    const cfg = getConfig();
    req.session.user = { email, name: cfg.clientName, isOwner: false, tier: cfg.tier || "client" };
    return res.redirect("/runway-dashboard.html");
  }

  if (demoLoginEnabled && isDemoLogin(email, password)) {
    req.session.user = { email, name: DEMO_USER.name };
    return res.redirect("/runway-dashboard.html");
  }

  return res.redirect("/runway-login.html?error=invalid");
});

app.post("/api/runway/forgot", (_req, res) => {
  res.redirect("/runway-login.html?reset=sent");
});

app.post("/api/runway/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/runway-login.html");
  });
});

// Admin: list all client services (owner only)
app.get("/api/runway/admin/clients", async (req, res) => {
  if (!req.session?.user?.isOwner) return res.status(403).json({ error: "Owner access required" });
  const apiKey = process.env.RENDER_API_KEY;
  if (!apiKey) return res.json({ clients: [] });
  try {
    const r = await fetch("https://api.render.com/v1/services?limit=100", {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    const data = await r.json();
    const clients = (Array.isArray(data) ? data : [])
      .filter(s => s.service?.name?.startsWith("runway-") && s.service?.name !== "age-runway-owner")
      .map(s => ({
        id:        s.service.id,
        name:      s.service.name,
        company:   s.service.name.replace(/^runway-/, "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
        url:       s.service.serviceDetails?.url || "",
        status:    s.service.suspended === "not_suspended" ? "active" : "suspended",
        createdAt: s.service.createdAt,
        dashboardUrl: s.service.dashboardUrl || "",
      }))
      .sort((a, b) => a.company.localeCompare(b.company));
    res.json({ clients });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Who am I? (called by the dashboard on load) ---
app.get("/api/runway/me", (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: "Not authenticated" });
  const cfg = getConfig();
  res.json({
    email: req.session.user.email,
    name: req.session.user.name,
    isOwner: req.session.user.isOwner === true,
    tier: req.session.user.tier || "client",
    clientName: cfg.clientName,
    company: cfg.company,
  });
});

// --- Stripe checkout (client deployments only) ---
app.post("/api/runway/checkout", async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      error: "Stripe checkout is not configured on this instance. Contact support@ageflowops.com to book manually.",
      stub: true,
    });
  }
  try {
    const { tier, email } = req.body || {};
    const priceKey = `STRIPE_RUNWAY_PRICE_${String(tier || "").toUpperCase()}`;
    const priceId = process.env[priceKey];
    if (!priceId) return res.status(400).json({ error: `Unknown tier: ${tier}` });

    const cfg = getConfig();
    const siteUrl = process.env.SITE_URL || `http://localhost:${PORT}`;
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email || undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${siteUrl}/runway-success.html?tier=${encodeURIComponent(tier)}`,
      cancel_url: `${siteUrl}/runway-pricing.html`,
      metadata: { tier, product: cfg.product || "Runway" },
    });
    res.json({ url: checkoutSession.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Admin: onboard a new client (owner only — spins up Render service) ---
app.post("/api/runway/admin/onboard", async (req, res) => {
  if (!req.session?.user?.isOwner) return res.status(403).json({ error: "Owner access required" });
  try {
    const {
      clientEmail, clientPassword, clientName, company, website,
      tier, product, destinations, voiceId, templateId,
      cta, color, audience, tone, logoUrl, phrasesUse, phrasesAvoid,
    } = req.body || {};

    if (!clientEmail || !clientPassword || !company) {
      return res.status(400).json({ error: "clientEmail, clientPassword and company are required" });
    }

    const slug = company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 28);
    const serviceName = `runway-${slug}`;
    const squawk = `RWY-${String(Math.floor(1000 + Math.random() * 9000))}`;

    const STRIPE_KEYS = [
      "STRIPE_RUNWAY_PRICE_STARTER_FOUNDING","STRIPE_RUNWAY_PRICE_STARTER",
      "STRIPE_RUNWAY_PRICE_GROWTH_FOUNDING","STRIPE_RUNWAY_PRICE_GROWTH",
      "STRIPE_RUNWAY_PRICE_SCALE","STRIPE_RUNWAY_PRICE_AGENCY",
    ];
    const stripePrices = Object.fromEntries(
      STRIPE_KEYS.filter(k => process.env[k]).map(k => [k, process.env[k]])
    );

    const result = await createClientService({
      name: serviceName, clientEmail, clientPassword,
      tier: tier || "starter", company,
      clientName: clientName || company,
      voiceId: voiceId || "", cta: cta || "",
      color: color || "#1e40af", audience: audience || "",
      tone: tone || "direct", product: product || "Inspect",
      destinations: Array.isArray(destinations) ? destinations : ["Instagram","TikTok","YouTube","LinkedIn"],
      logoUrl: logoUrl || "", website: website || "", squawk,
      phrasesUse:   Array.isArray(phrasesUse)   ? phrasesUse   : [],
      phrasesAvoid: Array.isArray(phrasesAvoid) ? phrasesAvoid : [],
      templateId: templateId || "856453b5-c707-488e-a8ae-0dc7d47a90bc",
      stripePrices,
    });

    // Fire n8n product-onboarding webhook — non-blocking
    const tierLabels = {
      starter_founding: "Starter Founding $497/mo", starter: "Starter $497/mo",
      growth_founding: "Growth Founding $797/mo",   growth:  "Growth $797/mo",
      scale: "Scale $1,297/mo", agency: "Agency",
    };
    const { contentPillars, voiceSampleUrl, sheetId } = req.body || {};
    fetch("https://age.app.n8n.cloud/webhook/product-onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        business_name: "Runway",
        trigger: "deal_won",
        client_name: clientName || company,
        client_email: clientEmail,
        company,
        product_notes: [
          `Tier: ${tierLabels[tier] || tier}.`,
          `Platforms: ${(Array.isArray(destinations) ? destinations : ["Instagram","TikTok","YouTube","LinkedIn"]).join(", ")}.`,
          `Tone: ${tone || "direct"}.`,
          contentPillars  ? `Content pillars: ${contentPillars}.`          : "",
          voiceSampleUrl  ? `Voice sample URL: ${voiceSampleUrl}.`         : "Voice sample: NOT YET PROVIDED — block until received.",
          sheetId         ? `Google Sheet ID: ${sheetId}.`                 : "Google Sheet ID: NOT YET PROVIDED — block until received.",
          `Dashboard: ${result.url}. Squawk: ${squawk}.`,
        ].filter(Boolean).join(" "),
      }),
    }).catch(() => {});

    res.json({ ok: true, squawk, ...result, loginEmail: clientEmail, loginPassword: clientPassword });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Auto-provision helpers (used by the Stripe webhook) ---
const STRIPE_PRICE_KEYS = [
  "STRIPE_RUNWAY_PRICE_STARTER_FOUNDING", "STRIPE_RUNWAY_PRICE_STARTER",
  "STRIPE_RUNWAY_PRICE_GROWTH_FOUNDING", "STRIPE_RUNWAY_PRICE_GROWTH",
  "STRIPE_RUNWAY_PRICE_SCALE", "STRIPE_RUNWAY_PRICE_AGENCY",
];

function randomPassword() {
  return crypto.randomBytes(12).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 12) + "1!";
}

// Idempotency: don't double-provision if Stripe redelivers the event.
async function renderServiceExists(name) {
  const apiKey = process.env.RENDER_API_KEY;
  if (!apiKey) return false;
  try {
    const r = await fetch(`https://api.render.com/v1/services?name=${encodeURIComponent(name)}&limit=10`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });
    const data = await r.json();
    return (Array.isArray(data) ? data : []).some((s) => s.service?.name === name);
  } catch {
    return false;
  }
}

async function autoProvisionFromSession(session) {
  const email = (session.customer_details?.email || session.customer_email || "").trim().toLowerCase();
  if (!email) { console.warn("auto-provision: no customer email on session — skipping"); return; }

  const tier = session.metadata?.tier || "starter";
  const rawName = (session.customer_details?.name || email.split("@")[0]).trim();
  const company = rawName;
  let slug = company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 28);
  if (!slug) slug = "client-" + email.replace(/[^a-z0-9]/g, "").slice(0, 12);
  const serviceName = `runway-${slug}`;

  if (await renderServiceExists(serviceName)) {
    console.log("auto-provision: service already exists, skipping:", serviceName);
    return;
  }

  const clientPassword = randomPassword();
  const squawk = `RWY-${String(Math.floor(1000 + Math.random() * 9000))}`;
  const stripePrices = Object.fromEntries(STRIPE_PRICE_KEYS.filter((k) => process.env[k]).map((k) => [k, process.env[k]]));

  const result = await createClientService({
    name: serviceName, clientEmail: email, clientPassword,
    tier, company, clientName: rawName,
    product: "Inspect",
    destinations: ["Instagram", "TikTok", "YouTube", "LinkedIn"],
    color: "#1e40af", tone: "direct",
    templateId: "856453b5-c707-488e-a8ae-0dc7d47a90bc",
    squawk, stripePrices,
  });
  console.log(`auto-provisioned ${serviceName} for ${email} -> ${result.url}`);

  // Welcome the client + notify Omar via the n8n product-onboarding agent (non-blocking).
  const tierLabels = {
    starter_founding: "Starter Founding $497/mo", starter: "Starter $497/mo",
    growth_founding: "Growth Founding $797/mo", growth: "Growth $797/mo",
    scale: "Scale $1,297/mo", agency: "Agency",
  };
  fetch("https://age.app.n8n.cloud/webhook/product-onboarding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      business_name: "Runway",
      trigger: "deal_won",
      client_name: rawName,
      client_email: email,
      company,
      login_email: email,
      login_password: clientPassword,
      dashboard_url: result.url,
      product_notes: [
        `AUTO-PROVISIONED on payment. Tier: ${tierLabels[tier] || tier}.`,
        `Dashboard: ${result.url}. Login: ${email} / ${clientPassword}. Squawk: ${squawk}.`,
        `Ask the client for: a voice sample (ElevenLabs clone) + their Google Sheet ID.`,
        `Video style defaults to faceless (Shotstack); flip to avatar in Voice & brand for a talking head.`,
      ].join(" "),
    }),
  }).catch(() => {});
}

// Pipeline routes (must come after /me and /checkout so those aren't swallowed)
app.use("/api/runway", pipelineRouter);

app.use(express.static(publicDir));

app.listen(PORT, () => {
  console.log(`Runway server running on port ${PORT}${isProd ? " (production)" : ""}`);
  if (ownerModeEnabled && OWNER_USER.email) console.log(`Owner mode: ${OWNER_USER.email}`);
  if (clientModeEnabled) console.log(`Client mode: ${CLIENT_USER.email}`);
  if (demoLoginEnabled) console.log(`Demo login: ${DEMO_USER.email} / ${DEMO_USER.password}`);
});
