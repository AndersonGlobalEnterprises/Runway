import { getConfig, getFlightEdits, saveFlightEdits } from "./db.js";
import {
  getContentType,
  listContentTypes,
  getContentTypeSpec,
  resolveTemplateId,
  buildCreatomateModifications,
  resolveDeliveryMode,
  deliveryIncludesPost,
  getDefaultDeliveryMode,
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

export function resolveFlightDeliveryMode(flight) {
  const meta = getFlightEditMeta(flight.id);
  const notesMeta = parseNotesMeta(flight.notes);
  const contentTypeId = meta.contentType || notesMeta.contentType || "myth-bust";
  return resolveDeliveryMode(contentTypeId, meta.deliveryMode || notesMeta.deliveryMode);
}

export function buildEditState(flight, config) {
  const meta = getFlightEditMeta(flight.id);
  const notesMeta = parseNotesMeta(flight.notes);
  const mergedMeta = { ...notesMeta, ...meta };
  const contentTypeId = mergedMeta.contentType || notesMeta.contentType || "myth-bust";
  const ct = getContentType(contentTypeId);
  const brand = config.brand || {};
  const deliveryMode = resolveDeliveryMode(contentTypeId, mergedMeta.deliveryMode);
  const caption = flight.caption || mergedMeta.caption || "";

  const edit = {
    hook: flight.hook || "",
    fullScript: flight.fullScript || "",
    caption,
    hashtags: mergedMeta.hashtags || "",
    ctaLine: mergedMeta.ctaLine || brand.cta || "",
    tone: mergedMeta.tone || ct?.defaultTone || "direct",
    length: mergedMeta.length || ct?.defaultLength || "30s",
    contentType: contentTypeId,
    deliveryMode,
    linkedInPost: mergedMeta.linkedInPost || "",
    facebookPost: mergedMeta.facebookPost || "",
    xPost: mergedMeta.xPost || "",
    onScreenHook: mergedMeta.onScreenHook || flight.hook || "",
    onScreenCta: mergedMeta.onScreenCta || mergedMeta.ctaLine || brand.cta || "",
    primaryColor: mergedMeta.primaryColor || brand.primaryColor || "#1e40af",
    logoUrl: mergedMeta.logoUrl || brand.logoUrl || "",
    templateVariant: contentTypeId,
    platforms: parsePlatforms(flight.platforms, mergedMeta.platforms, config.destinations),
    scheduledAt: flight.scheduledAt || mergedMeta.scheduledAt || "",
    postFormat: mergedMeta.postFormat || ct?.defaultPostFormat || "reel",
    videoFieldsOverridden: Boolean(mergedMeta.videoFieldsOverridden),
    postFieldsOverridden: Boolean(mergedMeta.postFieldsOverridden),
    previewVideoUrl: mergedMeta.previewVideoUrl || "",
    audioUrl: flight.audioUrl || "",
    videoUrl: flight.videoUrl || mergedMeta.previewVideoUrl || "",
  };

  if (!edit.videoFieldsOverridden) {
    edit.onScreenHook = edit.hook || edit.onScreenHook;
    edit.onScreenCta = edit.ctaLine || edit.onScreenCta;
  }

  if (!edit.postFieldsOverridden && deliveryIncludesPost(deliveryMode)) {
    if (!edit.linkedInPost && caption) edit.linkedInPost = caption;
    if (!edit.facebookPost && caption) edit.facebookPost = caption;
    if (!edit.xPost && caption) edit.xPost = caption.slice(0, 280);
  }

  const spec = getContentTypeSpec();

  return {
    flight: { id: flight.id, topic: flight.topic, status: flight.status, product: flight.product, rowId: flight.rowId },
    edit,
    contentTypes: listContentTypes(),
    spec: {
      script: spec.fields.script,
      post: spec.fields.post,
      video: spec.fields.video,
      publish: spec.fields.publish,
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

  if (tab === "post") {
    next.postFieldsOverridden = true;
  }

  if (tab === "script" && !next.videoFieldsOverridden) {
    if (patch.hook != null) next.onScreenHook = patch.hook;
    if (patch.ctaLine != null) next.onScreenCta = patch.ctaLine;
    if (!next.postFieldsOverridden && deliveryIncludesPost(next.deliveryMode)) {
      if (patch.caption != null) {
        if (!patch.linkedInPost) next.linkedInPost = patch.caption;
        if (!patch.facebookPost) next.facebookPost = patch.caption;
        if (!patch.xPost) next.xPost = patch.caption.slice(0, 280);
      }
    }
  }

  if (patch.contentType) {
    const ct = getContentType(patch.contentType);
    if (ct && !patch.length) next.length = ct.defaultLength;
    if (ct && !patch.tone) next.tone = ct.defaultTone;
    if (ct && !patch.postFormat) next.postFormat = ct.defaultPostFormat;
    if (ct && patch.deliveryMode == null) next.deliveryMode = getDefaultDeliveryMode(patch.contentType);
    next.templateVariant = patch.contentType;
  }

  const metaPatch = {
    hashtags: next.hashtags,
    ctaLine: next.ctaLine,
    tone: next.tone,
    length: next.length,
    contentType: next.contentType,
    deliveryMode: next.deliveryMode,
    linkedInPost: next.linkedInPost,
    facebookPost: next.facebookPost,
    xPost: next.xPost,
    onScreenHook: next.onScreenHook,
    onScreenCta: next.onScreenCta,
    primaryColor: next.primaryColor,
    logoUrl: next.logoUrl,
    videoFieldsOverridden: next.videoFieldsOverridden,
    postFieldsOverridden: next.postFieldsOverridden,
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
        deliveryMode: next.deliveryMode,
        tone: next.tone,
        length: next.length,
        postFormat: next.postFormat,
        linkedInPost: next.linkedInPost,
        facebookPost: next.facebookPost,
        xPost: next.xPost,
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
  return ["Instagram", "TikTok", "YouTube", "LinkedIn", "Facebook", "X"];
}

function mergeCaptionHashtags(caption, hashtags) {
  const cap = (caption || "").trim();
  const tags = (hashtags || "").trim();
  if (!tags) return cap;
  if (cap.includes("#")) return cap;
  return `${cap} ${tags}`.trim();
}
