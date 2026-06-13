import { getConfig } from "./db.js";

function n8nUrl(pathSegment) {
  const cfg = getConfig();
  const base = (cfg.n8n?.baseUrl || "https://age.app.n8n.cloud").replace(/\/$/, "");
  const path = pathSegment.startsWith("/") ? pathSegment : `/${pathSegment}`;
  return `${base}${path}`;
}

export async function fetchQueue() {
  const cfg = getConfig();
  const url = n8nUrl(cfg.n8n?.statusPath || "/webhook/hce-status");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Status API HTTP ${res.status}`);
  const raw = await res.json();
  const rows = Array.isArray(raw) ? raw : raw.items || raw.rows || raw.data || [];
  return rows.map(normaliseRow);
}

export async function updateFlightStatus({
  product,
  rowId,
  status,
  hook,
  fullScript,
  caption,
  videoUrl,
  platforms,
  scheduledAt,
  notes,
}) {
  const cfg = getConfig();
  const url = n8nUrl(cfg.n8n?.updatePath || "/webhook/hce-update");
  const body = { product, row_id: rowId, status };
  if (hook != null) body.hook = hook;
  if (fullScript != null) body.full_script = fullScript;
  if (caption != null) body.caption = caption;
  if (videoUrl != null) body.video_url = videoUrl;
  if (platforms != null) body.platforms = platforms;
  if (scheduledAt != null) body.scheduled_at = scheduledAt;
  if (notes != null) body.notes = notes;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Update API HTTP ${res.status}`);
  return res.json().catch(() => ({ ok: true }));
}

export async function queueTopic({ topic, audience, vertical, notes, product, contentType, tone, length }) {
  const cfg = getConfig();
  const path =
    cfg.n8n?.queueTopicPath ||
    `/webhook/queue-topic-${cfg.slug || "first-flight"}`;
  const url = n8nUrl(path);
  const meta = { contentType: contentType || "myth-bust", tone, length };
  const notesPayload = notes || JSON.stringify(meta);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic,
      audience: audience || cfg.brand?.audience,
      vertical: vertical || cfg.brand?.vertical,
      notes: typeof notesPayload === "string" ? notesPayload : JSON.stringify(notesPayload),
      product: product || cfg.product || "Inspect",
      contentType: contentType || "myth-bust",
    }),
  });
  if (!res.ok) throw new Error(`Queue topic HTTP ${res.status}`);
  return res.json().catch(() => ({ ok: true }));
}

export async function triggerPipeline(product) {
  const cfg = getConfig();
  const triggers = cfg.n8n?.triggers || {};
  const path = triggers[product];
  if (!path) throw new Error(`No trigger for product: ${product}`);
  const url = n8nUrl(path);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`Trigger HTTP ${res.status}`);
  return res.json().catch(() => ({ ok: true }));
}

export function flightKey(flight) {
  return `${flight.product}::${flight.rowId}`;
}

export function normaliseRow(row, index = 0) {
  const g = (...keys) => {
    for (const k of keys) {
      if (row[k] != null && row[k] !== "") return String(row[k]);
      const match = Object.keys(row).find(
        (rk) =>
          rk.toLowerCase().replace(/[\s_-]/g, "") === k.toLowerCase().replace(/[\s_-]/g, "")
      );
      if (match && row[match] != null && row[match] !== "") return String(row[match]);
    }
    return "";
  };

  const rowId = g("row_number", "rowNumber", "row_id", "rowId", "Row ID", "id", "row") || String(index + 2);
  const product = g("product", "Product") || getConfig().product || "Inspect";

  return {
    id: `${product}::${rowId}`,
    rowId,
    product,
    topic: g("topic", "Topic", "title", "Title", "subject", "Subject"),
    status: g("status", "Status") || "Queued",
    hook: g("hook", "Hook"),
    fullScript: g("full_script", "fullScript", "script", "Script"),
    caption: g("caption", "Caption"),
    audioUrl: g("audio_url", "audioUrl", "Audio URL", "audio"),
    videoUrl: g("video_url", "videoUrl", "Video URL", "video"),
    platforms: g("platforms", "Platforms"),
    notes: g("notes", "Notes"),
    audience: g("audience", "Audience"),
    vertical: g("vertical", "Vertical"),
    publishedAt: g("published_at", "publishedAt", "Published At"),
    createdAt: g("created_at", "createdAt", "Created At", "date", "Date"),
    scheduledAt: g("scheduled_at", "scheduledAt", "Scheduled At"),
    raw: row,
  };
}

export const PIPELINE_STEPS = [
  "Queued",
  "Research Complete",
  "Script Ready",
  "Audio Ready",
  "Video Ready",
  "Approved",
  "Published",
];

export function stepIndex(status) {
  const idx = PIPELINE_STEPS.indexOf(status);
  return idx >= 0 ? idx : 0;
}
