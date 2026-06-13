import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../client/public");
const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === "production";

/** Dev/demo login. Set DEMO_LOGIN=false in production when real auth ships. */
const DEMO_USER = {
  email: "demo@agerunway.com",
  password: "runway123",
  name: "Demo Client",
};
const demoLoginEnabled = process.env.DEMO_LOGIN !== "false";

const app = express();
if (isProd) app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "runway-dev-secret-change-in-prod",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.redirect("/runway-login.html");
  }
  next();
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/runway-dashboard.html", requireAuth, (_req, res) => {
  res.sendFile(path.join(publicDir, "runway-dashboard.html"));
});

app.use(express.static(publicDir));

app.post("/api/runway/login", (req, res) => {
  if (!demoLoginEnabled) {
    return res.redirect("/runway-login.html?error=invalid");
  }

  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const password = String(req.body?.password || "");

  if (email === DEMO_USER.email && password === DEMO_USER.password) {
    req.session.user = { email, name: DEMO_USER.name };
    return res.redirect("/runway-dashboard.html");
  }

  return res.redirect("/runway-login.html?error=invalid");
});

app.post("/api/runway/forgot", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!isProd) {
    console.log(`[runway] password reset requested for ${email || "(empty)"}`);
  }
  return res.redirect("/runway-login.html?reset=sent");
});

app.get("/api/runway/client/summary", (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  res.json({
    videos: 8,
    topics: 12,
    platforms: 3,
    pipeline: "online",
    client: req.session.user.name,
  });
});

/** Checkout stays in portal for Stripe until Runway billing moves here. */
app.post("/api/runway/checkout", (_req, res) => {
  res.status(503).json({
    error:
      "Stripe checkout is not wired yet. Contact support@ageflowops.com to book manually.",
    stub: true,
  });
});

app.listen(PORT, () => {
  console.log(`Runway server running on port ${PORT}${isProd ? " (production)" : ""}`);
  if (!isProd && demoLoginEnabled) {
    console.log(`Demo login: ${DEMO_USER.email} / ${DEMO_USER.password}`);
  }
});
