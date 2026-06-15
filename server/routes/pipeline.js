import { Router } from "express";
import {
  getConfig,
  saveConfig,
  setManifestOverride,
  getLocalFlights,
  saveLocalFlights,
} from "../db.js";
import {
  fetchQueue,
  updateFlightStatus,
  queueTopic,
  triggerPipeline,
  flightKey,
  PIPELINE_STEPS,
  stepIndex,
  normaliseRow,
} from "../n8n.js";
import {
  generateScript,
  rewriteScript,
  recordScriptEdit,
  aiAvailable,
} from "../ai.js";
import { listContentTypes, buildCreatomateModifications, deliveryIncludesPost, deliveryIncludesVideo, getDefaultDeliveryMode } from "../content-types.js";
import { buildEditState, applyEditPatch, saveFlightEditMeta, getFlightEditMeta, resolveFlightDeliveryMode } from "../edit.js";
import { createRender, creatomateAvailable } from "../creatomate.js";
import { heygenAvailable, startHeyGenRender, getHeyGenStatus } from "../heygen.js";
import { getWeeklyFlightPlan, getPublishHints, strategyAvailable } from "../strategy.js";

const router = Router();

function requireSession(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: "Not authenticated" });
  next();
}

router.use(requireSession);

async function loadFlights() {
  let flights, source, online = true, error;
  try {
    const remote = await fetchQueue();
    if (remote.length) {
      saveLocalFlights(remote);
      flights = remote;
      source = "n8n";
    } else {
      flights = getLocalFlights();
      source = "local";
    }
  } catch (err) {
    flights = getLocalFlights();
    source = "cache";
    online = false;
    error = err.message;
  }
  await reconcileRenders(flights);
  return { flights, source, online, error };
}

// HeyGen renders are async — when a flight is mid-render, check its status and, once the
// avatar video is ready, write the URL back (local + sheet via n8n). Runs on every flights
// load so a dashboard refresh surfaces finished videos. Cheap: only flights flagged
// "rendering" hit the HeyGen API.
async function reconcileRenders(flights) {
  if (!heygenAvailable() || !Array.isArray(flights)) return flights;
  for (const f of flights) {
    const meta = getFlightEditMeta(f.id);
    if (!meta.heygenVideoId || meta.renderStatus !== "rendering") continue;
    try {
      const { status, url } = await getHeyGenStatus(meta.heygenVideoId);
      if (status === "completed" && url) {
        saveFlightEditMeta(f.id, {
          renderStatus: "ready",
          videoUrl: url,
          previewVideoUrl: meta.heygenPreview ? url : meta.previewVideoUrl,
        });
        updateLocalFlight(f.id, { videoUrl: url, status: "Video Ready" });
        f.videoUrl = url;
        f.status = "Video Ready";
        try {
          await updateFlightStatus({ product: f.product, rowId: f.rowId, status: "Video Ready", videoUrl: url });
        } catch {
          /* local ok */
        }
      } else if (status === "failed") {
        saveFlightEditMeta(f.id, { renderStatus: "failed" });
      }
    } catch {
      /* transient — retry next load */
    }
  }
  return flights;
}

function updateLocalFlight(id, patch) {
  const flights = getLocalFlights();
  const idx = flights.findIndex((f) => f.id === id || flightKey(f) === id);
  if (idx < 0) return null;
  flights[idx] = { ...flights[idx], ...patch };
  saveLocalFlights(flights);
  return flights[idx];
}

function findFlight(flights, id) {
  return flights.find((f) => f.id === id || flightKey(f) === id);
}

function applyManifestOverrides(flights, config) {
  const overrides = config.manifestOverrides || {};
  return flights.map((f) => {
    const key = flightKey(f);
    const o = overrides[key];
    if (!o) return f;
    return { ...f, scheduledAt: o.scheduledAt || f.scheduledAt, platforms: o.platforms || f.platforms };
  });
}

router.get("/client/summary", async (_req, res) => {
  const config = getConfig();
  const { flights, online } = await loadFlights();
  const manifest = flights.filter((f) =>
    ["Approved", "Published", "Video Ready", "Script Ready", "Audio Ready"].includes(f.status)
  );
  const hold = flights.filter((f) => ["Queued", "Research Complete", "Error"].includes(f.status));

  const activeManifest = manifest.filter((f) => f.status !== "Queued");
  let posts = 0;
  let videos = 0;
  for (const f of activeManifest) {
    const mode = resolveFlightDeliveryMode(f);
    if (deliveryIncludesPost(mode)) posts += 1;
    if (deliveryIncludesVideo(mode)) videos += 1;
  }

  res.json({
    client: config.clientName,
    company: config.company,
    tier: config.tier,
    squawk: config.squawk,
    videos,
    posts,
    pieces: posts + videos,
    topics: hold.length,
    platforms: config.destinations?.length || 0,
    pipeline: online ? "online" : "offline",
    ai: aiAvailable() ? "online" : "offline",
    nextDeparture: pickNextDeparture(flights),
    tracks: summariseTracks(flights),
  });
});

router.get("/config", (_req, res) => {
  const config = getConfig();
  res.json({
    ...config,
    aiAvailable: aiAvailable(),
  });
});

router.put("/config", (req, res) => {
  const allowed = ["clientName", "company", "tier", "slug", "squawk", "product", "destinations", "n8n", "integrations", "brand"];
  const patch = {};
  for (const key of allowed) {
    if (req.body?.[key] != null) patch[key] = req.body[key];
  }
  res.json(saveConfig(patch));
});

router.get("/brand", (_req, res) => {
  const config = getConfig();
  res.json({ brand: config.brand, memory: config.memory, integrations: config.integrations });
});

router.put("/brand", (req, res) => {
  const config = saveConfig({
    brand: req.body?.brand,
    integrations: req.body?.integrations,
  });
  res.json({ brand: config.brand, memory: config.memory, integrations: config.integrations });
});

router.get("/flights", async (_req, res) => {
  const config = getConfig();
  const payload = await loadFlights();
  res.json({
    ...payload,
    flights: applyManifestOverrides(payload.flights, config),
    steps: PIPELINE_STEPS,
  });
});

router.get("/content-types", (_req, res) => {
  res.json({ contentTypes: listContentTypes() });
});

router.get("/strategy/weekly", async (_req, res) => {
  const plan = await getWeeklyFlightPlan();
  res.json({ ...plan, available: strategyAvailable() });
});

router.get("/flights/:id/edit", async (req, res) => {
  const config = getConfig();
  const { flights } = await loadFlights();
  const flight = findFlight(flights, req.params.id);
  if (!flight) return res.status(404).json({ error: "Flight not found" });
  res.json(buildEditState(flight, config));
});

router.patch("/flights/:id/edit", async (req, res) => {
  const config = getConfig();
  const { flights, online } = await loadFlights();
  const flight = findFlight(flights, req.params.id);
  if (!flight) return res.status(404).json({ error: "Flight not found" });

  const tab = req.body?.tab || "script";
  const applied = applyEditPatch(flight, config, req.body?.edit || req.body, tab);

  const before = { hook: flight.hook, fullScript: flight.fullScript, caption: flight.caption };
  const after = {
    hook: applied.sheet.hook,
    fullScript: applied.sheet.fullScript,
    caption: applied.sheet.caption,
  };

  try {
    if (online) {
      await updateFlightStatus({
        product: flight.product,
        rowId: flight.rowId,
        status: flight.status,
        ...applied.sheet,
      });
    }
  } catch {
    /* local fallback */
  }

  updateLocalFlight(flight.id, {
    hook: applied.sheet.hook,
    fullScript: applied.sheet.fullScript,
    caption: applied.sheet.caption,
    platforms: applied.sheet.platforms,
    scheduledAt: applied.sheet.scheduledAt,
    notes: applied.sheet.notes,
  });

  if (tab === "script") recordScriptEdit({ before, after, topic: flight.topic });

  setManifestOverride(flightKey(flight), {
    scheduledAt: applied.edit.scheduledAt,
    platforms: applied.edit.platforms,
    postFormat: applied.edit.postFormat,
  });

  res.json({ ok: true, ...buildEditState({ ...flight, ...applied.sheet }, config) });
});

router.post("/flights/:id/render-preview", async (req, res) => {
  const config = getConfig();
  const { flights } = await loadFlights();
  const flight = findFlight(flights, req.params.id);
  if (!flight) return res.status(404).json({ error: "Flight not found" });

  const state = buildEditState(flight, config);
  const edit = { ...state.edit, ...(req.body?.edit || {}) };

  // Preferred engine: HeyGen avatar video. Async — kick it off, reconcile when ready.
  if (heygenAvailable()) {
    const script = edit.fullScript || edit.hook || "";
    try {
      const { videoId } = await startHeyGenRender({
        script,
        avatarId: config.integrations?.heygenAvatarId,
        voiceId: config.integrations?.heygenVoiceId,
        test: true,
      });
      saveFlightEditMeta(flight.id, { heygenVideoId: videoId, heygenPreview: true, renderStatus: "rendering" });
      updateLocalFlight(flight.id, { status: "Rendering" });
      return res.json({ ok: true, engine: "heygen", status: "rendering", videoId, message: "Avatar preview rendering — refresh in ~1–2 min." });
    } catch (err) {
      return res.status(502).json({ ok: false, engine: "heygen", error: err.message });
    }
  }

  // Fallback: Creatomate template render.
  const templateId = req.body?.templateId || state.templateId;
  const modifications = buildCreatomateModifications(edit, edit.contentType);
  const render = await createRender({ templateId, modifications, preview: true });
  const previewUrl = render.url || "";

  if (previewUrl) {
    saveFlightEditMeta(flight.id, { previewVideoUrl: previewUrl });
    updateLocalFlight(flight.id, { videoUrl: previewUrl, status: "Video Ready" });
    try {
      await updateFlightStatus({
        product: flight.product,
        rowId: flight.rowId,
        status: "Video Ready",
        videoUrl: previewUrl,
      });
    } catch {
      /* local ok */
    }
  }

  res.json({ ok: true, render, previewUrl, mock: render.mock || false });
});

router.post("/flights/:id/render-final", async (req, res) => {
  const config = getConfig();
  const { flights } = await loadFlights();
  const flight = findFlight(flights, req.params.id);
  if (!flight) return res.status(404).json({ error: "Flight not found" });

  const state = buildEditState(flight, config);
  const edit = { ...state.edit, ...(req.body?.edit || {}) };

  // Preferred engine: HeyGen avatar video (final = non-test). Async — reconcile when ready.
  if (heygenAvailable()) {
    const script = edit.fullScript || edit.hook || "";
    try {
      const { videoId } = await startHeyGenRender({
        script,
        avatarId: config.integrations?.heygenAvatarId,
        voiceId: config.integrations?.heygenVoiceId,
        test: false,
      });
      saveFlightEditMeta(flight.id, { heygenVideoId: videoId, heygenPreview: false, renderStatus: "rendering" });
      updateLocalFlight(flight.id, { status: "Rendering" });
      // Persist the script/caption now so they survive even before the video lands.
      try {
        await updateFlightStatus({
          product: flight.product,
          rowId: flight.rowId,
          status: "Rendering",
          hook: edit.hook,
          fullScript: edit.fullScript,
          caption: edit.caption,
        });
      } catch {
        /* local ok */
      }
      return res.json({ ok: true, engine: "heygen", status: "rendering", videoId, message: "Final avatar video rendering — refresh in ~1–2 min." });
    } catch (err) {
      return res.status(502).json({ ok: false, engine: "heygen", error: err.message });
    }
  }

  // Fallback: Creatomate template render.
  const templateId = req.body?.templateId || state.templateId;
  const modifications = buildCreatomateModifications(edit, edit.contentType);
  const render = await createRender({ templateId, modifications, preview: false });
  const videoUrl = render.url || "";

  if (videoUrl) {
    updateLocalFlight(flight.id, { videoUrl, status: "Video Ready" });
    try {
      await updateFlightStatus({
        product: flight.product,
        rowId: flight.rowId,
        status: "Video Ready",
        videoUrl,
        hook: edit.hook,
        fullScript: edit.fullScript,
        caption: edit.caption,
      });
    } catch {
      /* local ok */
    }
  }

  res.json({ ok: true, render, videoUrl, mock: render.mock || false });
});

router.get("/flights/:id/render-status", async (req, res) => {
  const { flights } = await loadFlights();
  const flight = findFlight(flights, req.params.id);
  if (!flight) return res.status(404).json({ error: "Flight not found" });
  const meta = getFlightEditMeta(flight.id);
  if (!meta.heygenVideoId) {
    return res.json({ status: flight.status, videoUrl: flight.videoUrl || "" });
  }
  if (meta.renderStatus === "ready" && (meta.videoUrl || flight.videoUrl)) {
    return res.json({ status: "completed", videoUrl: meta.videoUrl || flight.videoUrl });
  }
  const { status, url } = await getHeyGenStatus(meta.heygenVideoId);
  if (status === "completed" && url) {
    saveFlightEditMeta(flight.id, { renderStatus: "ready", videoUrl: url, previewVideoUrl: meta.heygenPreview ? url : meta.previewVideoUrl });
    updateLocalFlight(flight.id, { videoUrl: url, status: "Video Ready" });
    try { await updateFlightStatus({ product: flight.product, rowId: flight.rowId, status: "Video Ready", videoUrl: url }); } catch { /* local ok */ }
    return res.json({ status: "completed", videoUrl: url });
  }
  if (status === "failed") {
    saveFlightEditMeta(flight.id, { renderStatus: "failed" });
    return res.json({ status: "failed", error: "render failed" });
  }
  return res.json({ status: "rendering" });
});

router.get("/flights/:id/publish-hints", async (req, res) => {
  const { flights } = await loadFlights();
  const flight = findFlight(flights, req.params.id);
  if (!flight) return res.status(404).json({ error: "Flight not found" });
  const state = buildEditState(flight, getConfig());
  const hints = await getPublishHints({
    contentType: state.edit.contentType,
    platforms: state.edit.platforms,
    deliveryMode: state.edit.deliveryMode,
  });
  res.json({ hints, available: strategyAvailable() });
});

router.get("/flights/:id", async (req, res) => {
  const { flights } = await loadFlights();
  const flight = findFlight(flights, req.params.id);
  if (!flight) return res.status(404).json({ error: "Flight not found" });
  res.json({ flight, step: stepIndex(flight.status), steps: PIPELINE_STEPS });
});

router.post("/flights/queue", async (req, res) => {
  const topics = normaliseTopics(req.body);
  if (!topics.length) return res.status(400).json({ error: "At least one topic required" });

  const results = [];
  for (const t of topics) {
    try {
      if (process.env.N8N_QUEUE_ENABLED !== "false") {
        await queueTopic(t);
        results.push({ topic: t.topic, status: "queued", via: "n8n" });
      } else {
        const local = getLocalFlights();
        const ct = t.contentType || "myth-bust";
        const deliveryMode = getDefaultDeliveryMode(ct);
        const row = normaliseRow(
          {
            topic: t.topic,
            status: "Queued",
            product: t.product || getConfig().product,
            notes: JSON.stringify({ contentType: ct, deliveryMode, tone: t.tone, length: t.length }),
            created_at: new Date().toISOString(),
          },
          local.length
        );
        saveFlightEditMeta(row.id, { contentType: ct, deliveryMode, tone: t.tone, length: t.length });
        local.unshift(row);
        saveLocalFlights(local);
        results.push({ topic: t.topic, status: "queued", via: "local", id: row.id });
      }
    } catch (err) {
      results.push({ topic: t.topic, status: "error", error: err.message });
    }
  }

  res.json({ results });
});

router.patch("/flights/:id/status", async (req, res) => {
  const status = String(req.body?.status || "");
  if (!status) return res.status(400).json({ error: "status required" });

  const { flights, online } = await loadFlights();
  const flight = findFlight(flights, req.params.id);
  if (!flight) return res.status(404).json({ error: "Flight not found" });

  try {
    if (online) {
      await updateFlightStatus({
        product: flight.product,
        rowId: flight.rowId,
        status,
        hook: req.body?.hook,
        fullScript: req.body?.fullScript,
        caption: req.body?.caption,
      });
    } else {
      updateLocalFlight(flight.id, {
        status,
        hook: req.body?.hook,
        fullScript: req.body?.fullScript,
        caption: req.body?.caption,
      });
    }
    res.json({ ok: true, status });
  } catch (err) {
    updateLocalFlight(flight.id, { status, ...req.body });
    res.json({ ok: true, status, local: true, warning: err.message });
  }
});

router.patch("/flights/:id/script", async (req, res) => {
  const { flights, online } = await loadFlights();
  const flight = findFlight(flights, req.params.id);
  if (!flight) return res.status(404).json({ error: "Flight not found" });

  const before = {
    hook: flight.hook,
    fullScript: flight.fullScript,
    caption: flight.caption,
  };
  const after = {
    hook: req.body?.hook ?? flight.hook,
    fullScript: req.body?.fullScript ?? flight.fullScript,
    caption: req.body?.caption ?? flight.caption,
  };

  try {
    if (online) {
      await updateFlightStatus({
        product: flight.product,
        rowId: flight.rowId,
        status: req.body?.status || flight.status || "Script Ready",
        hook: after.hook,
        fullScript: after.fullScript,
        caption: after.caption,
      });
    }
  } catch {
    /* fall through to local */
  }

  updateLocalFlight(flight.id, {
    ...after,
    status: req.body?.status || flight.status || "Script Ready",
  });

  const memory = recordScriptEdit({ before, after, topic: flight.topic });
  res.json({ ok: true, memory });
});

router.post("/flights/:id/rewrite", async (req, res) => {
  const { flights } = await loadFlights();
  const flight = findFlight(flights, req.params.id);
  if (!flight) return res.status(404).json({ error: "Flight not found" });

  const rewritten = await rewriteScript({
    hook: req.body?.hook ?? flight.hook,
    fullScript: req.body?.fullScript ?? flight.fullScript,
    caption: req.body?.caption ?? flight.caption,
    linkedInPost: req.body?.linkedInPost,
    facebookPost: req.body?.facebookPost,
    xPost: req.body?.xPost,
    contentType: req.body?.contentType,
    deliveryMode: req.body?.deliveryMode,
    action: req.body?.action || "custom",
    customPrompt: req.body?.prompt,
  });

  res.json({ script: rewritten, ai: aiAvailable() });
});

router.post("/flights/:id/generate", async (req, res) => {
  const { flights } = await loadFlights();
  const flight = findFlight(flights, req.params.id);
  const topic = req.body?.topic || flight?.topic;
  if (!topic) return res.status(400).json({ error: "topic required" });

  const script = await generateScript({
    topic,
    notes: req.body?.notes || flight?.notes,
    contentType: req.body?.contentType,
    deliveryMode: req.body?.deliveryMode,
  });
  res.json({ script, ai: aiAvailable() });
});

router.post("/flights/:id/approve", async (req, res) => {
  const gate = req.body?.gate || "video";
  let status = "Approved";
  if (gate === "script") status = "Script Ready";
  else if (gate === "post") status = "Post Ready";
  else if (gate === "video") status = "Approved";

  const { flights } = await loadFlights();
  const flight = findFlight(flights, req.params.id);
  if (!flight) return res.status(404).json({ error: "Flight not found" });

  const mode = resolveFlightDeliveryMode(flight);
  if (gate === "post" && deliveryIncludesPost(mode)) {
    status = mode === "post" ? "Approved" : "Post Ready";
  }
  if (gate === "video" && !deliveryIncludesVideo(mode)) {
    return res.status(400).json({ error: "This flight is post-only — clear the post instead." });
  }

  await updateFlightStatus({
    product: flight.product,
    rowId: flight.rowId,
    status,
    hook: req.body?.hook ?? flight.hook,
    fullScript: req.body?.fullScript ?? flight.fullScript,
    caption: req.body?.caption ?? flight.caption,
  });

  res.json({ ok: true, status });
});

router.post("/flights/:id/publish", async (req, res) => {
  const { flights } = await loadFlights();
  const flight = findFlight(flights, req.params.id);
  if (!flight) return res.status(404).json({ error: "Flight not found" });

  await triggerPipeline(flight.product);
  if (flight.status === "Approved") {
    await updateFlightStatus({ product: flight.product, rowId: flight.rowId, status: "Published" });
  }
  res.json({ ok: true, triggered: flight.product });
});

router.post("/pipeline/trigger", async (req, res) => {
  const product = req.body?.product || getConfig().product;
  await triggerPipeline(product);
  res.json({ ok: true, product });
});

router.patch("/manifest/:id", (req, res) => {
  const override = setManifestOverride(req.params.id, {
    scheduledAt: req.body?.scheduledAt,
    platforms: req.body?.platforms,
  });
  res.json({ ok: true, override });
});

router.get("/health", async (_req, res) => {
  const config = getConfig();
  let n8n = false;
  try {
    await fetchQueue();
    n8n = true;
  } catch {
    n8n = false;
  }

  res.json({
    n8n,
    ai: aiAvailable(),
    creatomate: creatomateAvailable(),
    strategy: strategyAvailable(),
    voice: Boolean(config.integrations?.voiceId),
    sheet: Boolean(config.integrations?.sheetId),
  });
});

function normaliseTopics(body) {
  const contentType = body?.contentType || "myth-bust";
  const tone = body?.tone;
  const length = body?.length;
  if (Array.isArray(body?.topics)) {
    return body.topics
      .map((t) => (typeof t === "string" ? { topic: t, contentType } : { contentType, ...t }))
      .filter((t) => t?.topic?.trim());
  }
  if (body?.topic?.trim()) {
    return [{ topic: body.topic.trim(), notes: body.notes, product: body.product, contentType, tone, length }];
  }
  if (typeof body?.text === "string") {
    return body.text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((topic) => ({ topic, contentType, tone, length }));
  }
  return [];
}

function summariseTracks(flights) {
  const products = ["Inspect", "Talksmith", "Interview Prep"];
  return products.map((name) => {
    const items = flights.filter((f) => f.product === name);
    const active = items.filter((f) => !["Published", "Queued", "Error"].includes(f.status)).length;
    const hold = items.filter((f) => ["Queued", "Research Complete"].includes(f.status)).length;
    let status = `${active} on taxi · stable`;
    if (hold && !active) status = `On hold · ${hold} awaiting manifest`;
    if (active && hold) status = `${active} on taxi · ${hold} on hold`;
    return { name, count: items.length, active, hold, status };
  });
}

function pickNextDeparture(flights) {
  const upcoming = flights
    .filter((f) => f.scheduledAt && f.status !== "Published")
    .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt))[0];
  if (upcoming?.scheduledAt) {
    return new Date(upcoming.scheduledAt).toLocaleString("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  }
  const next = flights.find((f) => f.status === "Approved" || f.status === "Video Ready");
  return next ? "Ready to depart" : "Mon 9:00 AM";
}

export default router;
