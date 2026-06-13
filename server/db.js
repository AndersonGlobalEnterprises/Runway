import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../data");

const DEFAULT_CONFIG = {
  clientName: "First Flight Roofing",
  company: "First Flight Roofing",
  tier: "Growth",
  slug: "first-flight",
  squawk: "RWY-7426",
  product: "Inspect",
  destinations: ["Instagram", "TikTok", "YouTube"],
  n8n: {
    baseUrl: "https://age.app.n8n.cloud",
    statusPath: "/webhook/hce-status",
    updatePath: "/webhook/hce-update",
    queueTopicPath: "/webhook/queue-topic-first-flight",
    triggers: {
      Inspect: "/webhook/inspect-publish-run",
      Talksmith: "/webhook/talksmith-publish-run",
      "Interview Prep": "/webhook/interview-publish-run",
    },
  },
  integrations: {
    voiceId: "",
    sheetId: "",
    creatomateTemplateId: "",
  },
  brand: {
    audience: "Homeowners in storm-prone markets",
    vertical: "Residential roofing",
    tone: "Direct, trustworthy, local expert — no corporate jargon",
    hookStyle: "Bold question or myth-bust opener",
    cta: "Call for a free inspection",
    primaryColor: "#1e40af",
    logoUrl: "",
    phrasesUse: ["storm damage", "free inspection", "licensed & insured"],
    phrasesAvoid: ["synergy", "leverage", "best-in-class", "game-changer"],
    autoApproveScript: false,
    autoApproveVideo: false,
    autoPublishLinkedIn: false,
  },
  memory: {
    editSignals: [],
    approvedHooks: [],
    notes: [],
  },
  manifestOverrides: {},
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  return path.join(DATA_DIR, name);
}

function readJson(name, fallback) {
  ensureDataDir();
  const fp = filePath(name);
  if (!fs.existsSync(fp)) {
    writeJson(name, fallback);
    return structuredClone(fallback);
  }
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

function writeJson(name, data) {
  ensureDataDir();
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), "utf8");
}

export function getConfig() {
  const base = readJson("config.json", DEFAULT_CONFIG);
  return applyEnvOverrides(base);
}

function applyEnvOverrides(cfg) {
  const e = process.env;
  const out = structuredClone(cfg);
  if (e.CLIENT_COMPANY)       out.company = e.CLIENT_COMPANY;
  if (e.CLIENT_NAME)          out.clientName = e.CLIENT_NAME;
  if (e.CLIENT_TIER)          out.tier = e.CLIENT_TIER;
  if (e.CLIENT_SLUG)          out.slug = e.CLIENT_SLUG;
  if (e.CLIENT_SQUAWK)        out.squawk = e.CLIENT_SQUAWK;
  if (e.CLIENT_PRODUCT)       out.product = e.CLIENT_PRODUCT;
  if (e.CLIENT_DESTINATIONS)  out.destinations = e.CLIENT_DESTINATIONS.split(",").map(s => s.trim());
  if (!out.integrations) out.integrations = {};
  if (e.CLIENT_VOICE_ID)      out.integrations.voiceId = e.CLIENT_VOICE_ID;
  if (e.CLIENT_TEMPLATE_ID)   out.integrations.creatomateTemplateId = e.CLIENT_TEMPLATE_ID;
  if (!out.brand) out.brand = {};
  if (e.CLIENT_CTA)           out.brand.cta = e.CLIENT_CTA;
  if (e.CLIENT_COLOR)         out.brand.primaryColor = e.CLIENT_COLOR;
  if (e.CLIENT_AUDIENCE)      out.brand.audience = e.CLIENT_AUDIENCE;
  if (e.CLIENT_TONE)          out.brand.tone = e.CLIENT_TONE;
  if (e.CLIENT_LOGO_URL)      out.brand.logoUrl = e.CLIENT_LOGO_URL;
  if (e.CLIENT_WEBSITE)       out.brand.website = e.CLIENT_WEBSITE;
  if (e.CLIENT_PHRASES_USE)   out.brand.phrasesUse = e.CLIENT_PHRASES_USE.split(",").map(s => s.trim());
  if (e.CLIENT_PHRASES_AVOID) out.brand.phrasesAvoid = e.CLIENT_PHRASES_AVOID.split(",").map(s => s.trim());
  return out;
}

export function saveConfig(partial) {
  const current = getConfig();
  const next = deepMerge(current, partial);
  writeJson("config.json", next);
  return next;
}

export function getLocalFlights() {
  return readJson("flights-local.json", []);
}

export function saveLocalFlights(flights) {
  writeJson("flights-local.json", flights);
  return flights;
}

export function appendMemorySignal(signal) {
  const config = getConfig();
  config.memory.editSignals.unshift({
    ...signal,
    at: new Date().toISOString(),
  });
  config.memory.editSignals = config.memory.editSignals.slice(0, 100);
  writeJson("config.json", config);
  return config.memory;
}

export function appendApprovedHook(hook) {
  const config = getConfig();
  if (hook && !config.memory.approvedHooks.includes(hook)) {
    config.memory.approvedHooks.unshift(hook);
    config.memory.approvedHooks = config.memory.approvedHooks.slice(0, 20);
  }
  writeJson("config.json", config);
}

export function setManifestOverride(flightKey, data) {
  const config = getConfig();
  config.manifestOverrides[flightKey] = { ...config.manifestOverrides[flightKey], ...data };
  writeJson("config.json", config);
  return config.manifestOverrides[flightKey];
}

export function getFlightEdits() {
  return readJson("flight-edits.json", {});
}

export function saveFlightEdits(edits) {
  writeJson("flight-edits.json", edits);
  return edits;
}

function deepMerge(base, patch) {
  if (patch == null || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] =
      v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object"
        ? deepMerge(base[k], v)
        : v;
  }
  return out;
}
