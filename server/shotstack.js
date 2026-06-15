// Shotstack faceless video engine for Runway.
// Builds a complete vertical short from scratch: the client's ElevenLabs voiceover drives
// the length + auto-captions, B-roll (Pexels) fills the background, the hook + CTA + logo
// layer on top. No avatar, no face — the default Runway style.
//
// Renders are asynchronous (Shotstack queues them), so we START a render and reconcile the
// result on the next flights load / status poll — never block an HTTP request.

const ENV = (process.env.SHOTSTACK_ENV || "v1").trim(); // "v1" = production (clean), "stage" = sandbox (watermarked, free)
const API_BASE = `https://api.shotstack.io/edit/${ENV}`;
const PEXELS_BASE = "https://api.pexels.com/videos/search";

export function shotstackAvailable() {
  return Boolean(process.env.SHOTSTACK_API_KEY);
}

// Google Drive /view links return an HTML page; convert to direct-download so Shotstack
// can fetch the raw MP3 (the client's ElevenLabs cloned-voice audio) / logo image.
function toDirectUrl(url) {
  if (!url) return url;
  const m = String(url).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([A-Za-z0-9_-]+)/);
  return m ? `https://drive.google.com/uc?export=download&id=${m[1]}` : url;
}

function headers() {
  return { "x-api-key": process.env.SHOTSTACK_API_KEY, "Content-Type": "application/json" };
}

// Ask Shotstack how long the voiceover is so the timeline matches it exactly.
async function probeDuration(url) {
  try {
    const res = await fetch(`${API_BASE}/probe/${encodeURIComponent(url)}`, { headers: headers() });
    const data = await res.json().catch(() => ({}));
    const meta = data?.response?.metadata || {};
    const fmtDur = parseFloat(meta?.format?.duration);
    if (Number.isFinite(fmtDur) && fmtDur > 0) return fmtDur;
    const streams = meta?.streams || [];
    for (const s of streams) {
      const d = parseFloat(s?.duration);
      if (Number.isFinite(d) && d > 0) return d;
    }
  } catch {
    /* fall through to default */
  }
  return 0;
}

// Pull portrait B-roll clips for the topic. Optional — without a PEXELS_API_KEY the engine
// uses a clean branded gradient background instead.
async function fetchBroll(query, want) {
  const key = process.env.PEXELS_API_KEY;
  if (!key || !query) return [];
  try {
    const q = encodeURIComponent(query);
    const res = await fetch(`${PEXELS_BASE}?query=${q}&orientation=portrait&size=medium&per_page=15`, {
      headers: { Authorization: key },
    });
    const data = await res.json().catch(() => ({}));
    const out = [];
    for (const v of data?.videos || []) {
      // Prefer a portrait mp4 of reasonable size.
      const files = (v.video_files || [])
        .filter((f) => f.file_type === "video/mp4" && f.height >= f.width)
        .sort((a, b) => (a.height || 0) - (b.height || 0));
      const pick = files.find((f) => (f.height || 0) >= 1000) || files[files.length - 1] || files[0];
      if (pick?.link) out.push(pick.link);
      if (out.length >= want) break;
    }
    return out;
  } catch {
    return [];
  }
}

function brandGradientHtml(color) {
  const c = color || "#1e40af";
  return {
    type: "html",
    width: 720,
    height: 1280,
    html: `<div style="width:720px;height:1280px;"></div>`,
    css: `div{background:linear-gradient(160deg,${c} 0%,#0b1220 100%);}`,
    background: "transparent",
  };
}

// Kick off a faceless render. Returns { renderId } immediately (does NOT wait for completion).
// Requires audioUrl (the voiceover) — that's what a faceless video is built around.
export async function startFacelessRender({
  audioUrl,
  hook,
  cta,
  logoUrl,
  primaryColor,
  keywords,
  width = 720,
  height = 1280,
}) {
  const key = process.env.SHOTSTACK_API_KEY;
  if (!key) return { mock: true, renderId: "", status: "mock", message: "Set SHOTSTACK_API_KEY for real faceless renders." };
  const audio = toDirectUrl(audioUrl);
  if (!audio) throw new Error("Faceless render needs a voiceover — generate the cloned-voice audio first.");

  const duration = (await probeDuration(audio)) || 30;
  const D = Math.max(3, Math.round(duration * 100) / 100);

  // Background: B-roll if available, else a branded gradient.
  const wantClips = Math.min(8, Math.max(1, Math.ceil(D / 5)));
  const broll = await fetchBroll(keywords, wantClips);
  const bgTrack = { clips: [] };
  if (broll.length) {
    const per = Math.max(2, Math.round((D / broll.length) * 100) / 100);
    let t = 0;
    broll.forEach((src, i) => {
      const len = i === broll.length - 1 ? Math.max(2, Math.round((D - t) * 100) / 100) : per;
      if (len <= 0) return;
      bgTrack.clips.push({
        asset: { type: "video", src, volume: 0 },
        start: Math.round(t * 100) / 100,
        length: len,
        fit: "cover",
        effect: i % 2 === 0 ? "zoomIn" : "zoomOut",
        transition: i === 0 ? undefined : { in: "fade" },
      });
      t += len;
    });
  } else {
    bgTrack.clips.push({ asset: brandGradientHtml(primaryColor), start: 0, length: D, fit: "cover" });
  }

  // Auto karaoke captions transcribed from the voiceover. (Shotstack caption assets accept
  // type/src/font/background only — vertical placement is done via the clip's position/offset.)
  const captionTrack = {
    clips: [
      {
        asset: {
          type: "caption",
          src: audio,
          font: { family: "Montserrat ExtraBold", size: 42, color: "#ffffff", lineHeight: 0.9 },
          background: { color: "#000000", opacity: 0.35, padding: 14, borderRadius: 12 },
        },
        start: 0,
        length: D,
        position: "bottom",
        offset: { y: 0.18 },
      },
    ],
  };

  // Hook (first 3s) + CTA (last 3s) titles.
  const titleClips = [];
  if (hook) {
    titleClips.push({
      asset: { type: "title", text: hook, style: "subtitle", size: "large", color: "#ffffff", background: "#000000" },
      start: 0,
      length: Math.min(3, D),
      position: "center",
      transition: { in: "fade", out: "fade" },
    });
  }
  if (cta && D > 4) {
    titleClips.push({
      asset: { type: "title", text: cta, style: "subtitle", size: "medium", color: "#ffffff", background: primaryColor || "#1e40af" },
      start: Math.max(0, D - 3),
      length: 3,
      position: "center",
      transition: { in: "fade", out: "fade" },
    });
  }

  // Logo (top-right, full duration).
  const logoTrack = { clips: [] };
  const logo = toDirectUrl(logoUrl);
  if (logo) {
    logoTrack.clips.push({
      asset: { type: "image", src: logo },
      start: 0,
      length: D,
      position: "topRight",
      offset: { x: -0.04, y: -0.04 },
      scale: 0.18,
    });
  }

  // Track order = top layer first. Captions over titles over logo over B-roll background.
  const tracks = [captionTrack, { clips: titleClips }, logoTrack, bgTrack].filter((t) => t.clips.length);

  const body = {
    timeline: {
      soundtrack: undefined,
      background: "#000000",
      tracks,
    },
    output: { format: "mp4", size: { width, height }, fps: 30 },
  };
  // Voiceover audio on its own track (kept last so it never affects visual layering).
  body.timeline.tracks.push({ clips: [{ asset: { type: "audio", src: audio }, start: 0, length: D }] });

  const res = await fetch(`${API_BASE}/render`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const msg = data?.message || data?.response?.error || `HTTP ${res.status}`;
    throw new Error(`Shotstack render failed: ${msg}`);
  }
  return { renderId: data?.response?.id || "", status: "rendering" };
}

// Check a render. Returns { status: "completed"|"rendering"|"failed"|"unknown", url, error }.
export async function getShotstackStatus(renderId) {
  const key = process.env.SHOTSTACK_API_KEY;
  if (!key || !renderId) return { status: "unknown", url: "" };
  const res = await fetch(`${API_BASE}/render/${encodeURIComponent(renderId)}`, { headers: headers() });
  const data = await res.json().catch(() => ({}));
  const r = data?.response || {};
  const raw = r.status || "unknown";
  // Shotstack statuses: queued, fetching, rendering, saving, done, failed
  let status = "rendering";
  if (raw === "done") status = "completed";
  else if (raw === "failed") status = "failed";
  else if (["queued", "fetching", "rendering", "saving"].includes(raw)) status = "rendering";
  else status = "unknown";
  return { status, url: r.url || "", error: r.error };
}
