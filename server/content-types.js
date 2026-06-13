import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = path.join(__dirname, "../data/content-types.json");

let cached = null;

export function getContentTypeSpec() {
  if (cached) return cached;
  cached = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  return cached;
}

export function getContentType(id) {
  const spec = getContentTypeSpec();
  return spec.contentTypes.find((t) => t.id === id) || spec.contentTypes[0];
}

export function listContentTypes() {
  return getContentTypeSpec().contentTypes;
}

export function resolveTemplateId(contentTypeId, fallbackId) {
  const ct = getContentType(contentTypeId);
  const id = ct?.creatomateTemplateId;
  if (id && !id.startsWith("REPLACE_")) return id;
  return fallbackId || "";
}

export function buildCreatomateModifications(edit, contentTypeId) {
  const ct = getContentType(contentTypeId);
  const mods = {
    "Hook-Text": edit.onScreenHook || edit.hook || "",
    "CTA-Text": edit.onScreenCta || edit.ctaLine || "",
    "Primary-Color": edit.primaryColor || "#1e40af",
  };
  if (edit.logoUrl) mods["Logo-Image"] = edit.logoUrl;
  if (edit.audioUrl) mods["Voice-Audio"] = edit.audioUrl;
  if (ct?.videoDefaults) Object.assign(mods, ct.videoDefaults);
  return mods;
}
