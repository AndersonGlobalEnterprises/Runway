import { getConfig, getFlightEdits, saveFlightEdits } from "./db.js";
import {
  getContentType,
  listContentTypes,
  getContentTypeSpec,
  resolveTemplateId,
  buildCreatomateModifications,
} from "./content-types.js";

function parseNotesMeta(notes) {
  if (!notes) return {};
  try {
    if (notes.startsWith("{")) return JSON.parse(notes);
  } catch {
    /* plain text notes */
  }
  return {};
}

export function getFlightEditMeta(flightId) {
  const all = getFlightEdits();
  return all[flightId] || {};
}

export function saveFlightEditMeta(flightId, patch) {
  const all = getFlightEdits();
  all[flightId] = { ...all[flightId], ...patch, updatedAt: new Date().toISOString() };
  saveFlightEdits(all);
  return all[flightId];
}

export function buildEditState(flight, config) {
  const meta = getFlightEditMeta(flight.id);
  const notesMeta = parseNotesMeta(flight.notes);
  const mergedMeta = { ...notesMeta, ...meta };
  const contentTypeId = mergedMeta.contentType || notesMeta.contentType || "myth-bust";
  const ct = getContentType(contentTypeId);
  const brand = config.brand || {};

  const edit = {
    hook: flight.hook || "",
    fullScript: flight.fullScript || "",
    caption: flight.caption || "",
    hashtags: mergedMeta.hashtags || "",
    ctaLine: mergedMeta.ctaLine || brand.cta || "",
    tone: mergedMeta.tone || ct?.defaultTone || "direct",
    length: mergedMeta.length || ct?.defaultLength || "30s",
    contentType: contentTypeId,
    onScreenHook: mergedMeta.onScreenHook || flight.hook || "",
    onScreenCta: mergedMeta.onScreenCta || mergedMeta.ctaLine || brand.cta || "",
    primaryColor: mergedMeta.primaryColor || brand.primaryColor || "#1e40af",
    logoUrl: mergedMeta.logoUrl || brand.logoUrl || "",
    templateVariant: contentTypeId,
    platforms: parsePlatforms(flight.platforms, mergedMeta.platforms, config.destinations),
    scheduledAt: flight.scheduledAt || mergedMeta.scheduledAt || "",
    postFormat: mergedMeta.postFormat || ct?.defaultPostFormat || "reel",
    videoFieldsOverridden: Boolean(mergedMeta.videoFieldsOverridden),
    previewVideoUrl: mergedMeta.previewVideoUrl || "",
    audioUrl: flight.audioUrl || "",
    videoUrl: flight.videoUrl || mergedMeta.previewVideoUrl || "",
  };

  if (!edit.videoFieldsOverridden) {
    edit.onScreenHook = edit.hook || edit.onScreenHook;
    edit.onScreenCta = edit.ctaLine || edit.onScreenCta;
  }

  return {
    flight: { id: flight.id, topic: flight.topic, status: flight.status, product: flight.product, rowId: flight.rowId },
    edit,
    contentTypes: listContentTypes(),
    spec: {
      script: getContentTypeSpec().fields.script,
      video: getContentTypeSpec().fields.video,
      publish: getContentTypeSpec().fields.publish,
    },
    templateId: resolveTemplateId(contentTypeId, config.integrations?.creatomateTemplateId),
    creatomateModifications: buildCreatomateModifications(edit, contentTypeId),
  };
}

export function applyEditPatch(flight, config, patch, tab) {
  const current = buildEditState(flight, config).edit;
  const next = { ...current, ...patch };

  if (tab === "video") {
    next.videoFieldsOverridden = true;
  }

  if (tab === "script" && !next.videoFieldsOverridden) {
    if (patch.hook != null) next.onScreenHook = patch.hook;
    if (patch.ctaLine != null) next.onScreenCta = patch.ctaLine;
  }

  if (patch.contentType) {
    const ct = getContentType(patch.contentType);
    if (ct && !patch.length) next.length = ct.defaultLength;
    if (ct && !patch.tone) next.tone = ct.defaultTone;
    if (ct && !patch.postFormat) next.postFormat = ct.defaultPostFormat;
    next.templateVariant = patch.contentType;
  }

  const metaPatch = {
    hashtags: next.hashtags,
    ctaLine: next.ctaLine,
    tone: next.tone,
    length: next.length,
    contentType: next.contentType,
    onScreenHook: next.onScreenHook,
    onScreenCta: next.onScreenCta,
    primaryColor: next.primaryColor,
    logoUrl: next.logoUrl,
    videoFieldsOverridden: next.videoFieldsOverridden,
    postFormat: next.postFormat,
    scheduledAt: next.scheduledAt,
    platforms: Array.isArray(next.platforms) ? next.platforms : parsePlatforms(next.platforms),
    previewVideoUrl: next.previewVideoUrl,
  };

  saveFlightEditMeta(flight.id, metaPatch);

  const fullCaption = mergeCaptionHashtags(next.caption, next.hashtags);

  return {
    edit: next,
    sheet: {
      hook: next.hook,
      fullScript: next.fullScript,
      caption: fullCaption,
      platforms: (Array.isArray(next.platforms) ? next.platforms : []).join(" · "),
      scheduledAt: next.scheduledAt,
      notes: JSON.stringify({
        contentType: next.contentType,
        tone: next.tone,
        length: next.length,
        postFormat: next.postFormat,
      }),
    },
    templateId: resolveTemplateId(next.contentType, config.integrations?.creatomateTemplateId),
    creatomateModifications: buildCreatomateModifications(next, next.contentType),
  };
}

function parsePlatforms(...sources) {
  for (const src of sources) {
    if (Array.isArray(src) && src.length) return src;
    if (typeof src === "string" && src.trim()) {
      return src.split(/[·,|]/).map((s) => s.trim()).filter(Boolean);
    }
  }
  return ["Instagram", "TikTok", "YouTube"];
}

function mergeCaptionHashtags(caption, hashtags) {
  const cap = (caption || "").trim();
  const tags = (hashtags || "").trim();
  if (!tags) return cap;
  if (cap.includes("#")) return cap;
  return `${cap} ${tags}`.trim();
}
