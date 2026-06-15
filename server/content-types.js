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

export function getDefaultDeliveryMode(contentTypeId) {
  const ct = getContentType(contentTypeId);
  return ct?.defaultDeliveryMode || "video";
}

export function resolveDeliveryMode(contentTypeId, override) {
  if (override && ["post", "video", "hybrid"].includes(override)) return override;
  return getDefaultDeliveryMode(contentTypeId);
}

export function deliveryIncludesVideo(mode) {
  return mode === "video" || mode === "hybrid";
}

export function deliveryIncludesPost(mode) {
  return mode === "post" || mode === "hybrid";
}

// Google Drive share links (/file/d/<id>/view, open?id=) return an HTML viewer page, which
// Creatomate cannot use as media — it silently falls back to the template's default audio.
// Convert to the direct-download form so the real MP3/asset is fetched.
function toDirectDownloadUrl(url) {
  if (!url) return url;
  const m = String(url).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([A-Za-z0-9_-]+)/);
  return m ? `https://drive.google.com/uc?export=download&id=${m[1]}` : url;
}

export function buildCreatomateModifications(edit, contentTypeId) {
  const mode = resolveDeliveryMode(contentTypeId, edit.deliveryMode);
  if (!deliveryIncludesVideo(mode)) return {};

  const ct = getContentType(contentTypeId);
  const mods = {
    "Hook-Text": edit.onScreenHook || edit.hook || "",
    "CTA-Text": edit.onScreenCta || edit.ctaLine || "",
    "Primary-Color": edit.primaryColor || "#1e40af",
  };
  if (edit.logoUrl) mods["Logo-Image"] = toDirectDownloadUrl(edit.logoUrl);
  if (edit.audioUrl) mods["Voice-Audio"] = toDirectDownloadUrl(edit.audioUrl);
  if (ct?.videoDefaults) Object.assign(mods, ct.videoDefaults);
  return mods;
}
