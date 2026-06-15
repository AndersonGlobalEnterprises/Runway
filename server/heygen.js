// HeyGen avatar video engine for Runway.
// Renders are asynchronous (minutes), so we START a render and reconcile the result
// on the next flights load / status poll — never block an HTTP request waiting.

const API_BASE = "https://api.heygen.com";

// Sensible defaults (verified working). Override per-instance via config.integrations
// or env HEYGEN_AVATAR_ID / HEYGEN_VOICE_ID.
const DEFAULT_AVATAR = "Abigail_standing_office_front";
const DEFAULT_VOICE = "cef3bc4e0a84424cafcde6f2cf466c97";

// Google Drive /view links return an HTML page; convert to direct-download so HeyGen
// can fetch the raw MP3 (the client's ElevenLabs cloned-voice audio).
function toDirectAudioUrl(url) {
  if (!url) return url;
  const m = String(url).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([A-Za-z0-9_-]+)/);
  return m ? `https://drive.google.com/uc?export=download&id=${m[1]}` : url;
}

export function heygenAvailable() {
  return Boolean(process.env.HEYGEN_API_KEY);
}

// Kick off an avatar render. Returns { videoId } immediately (does NOT wait for completion).
// voice: pass audioUrl to lip-sync to a pre-generated MP3 (e.g. the client's ElevenLabs clone);
// otherwise it speaks `script` with a HeyGen voice_id.
export async function startHeyGenRender({ script, avatarId, talkingPhotoId, voiceId, audioUrl, test = false, width = 720, height = 1280 }) {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) {
    return { mock: true, videoId: "", status: "mock", message: "Set HEYGEN_API_KEY for real avatar renders." };
  }
  if (!audioUrl && (!script || !script.trim())) {
    throw new Error("No script to speak — generate the script first.");
  }

  const audio = audioUrl ? toDirectAudioUrl(audioUrl) : null;
  const voice = audio
    ? { type: "audio", audio_url: audio }
    : { type: "text", input_text: script, voice_id: voiceId || process.env.HEYGEN_VOICE_ID || DEFAULT_VOICE };

  // Per-client custom avatar = a Talking Photo (their selfie). Falls back to a studio avatar.
  const character = talkingPhotoId
    ? { type: "talking_photo", talking_photo_id: talkingPhotoId }
    : { type: "avatar", avatar_id: avatarId || process.env.HEYGEN_AVATAR_ID || DEFAULT_AVATAR, avatar_style: "normal" };

  const body = {
    video_inputs: [{ character, voice }],
    dimension: { width, height },
    test: Boolean(test),
  };

  const res = await fetch(`${API_BASE}/v2/video/generate`, {
    method: "POST",
    headers: { "X-Api-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error?.message || data.error || data.message || `HTTP ${res.status}`;
    throw new Error(`HeyGen generate failed: ${msg}`);
  }
  return { videoId: data.data?.video_id || "", status: "rendering" };
}

// Check a render. Returns { status: "completed"|"processing"|"pending"|"failed"|"unknown", url, error }.
export async function getHeyGenStatus(videoId) {
  const key = process.env.HEYGEN_API_KEY;
  if (!key || !videoId) return { status: "unknown", url: "" };
  const res = await fetch(`${API_BASE}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`, {
    headers: { "X-Api-Key": key },
  });
  const data = await res.json().catch(() => ({}));
  const d = data.data || {};
  return { status: d.status || "unknown", url: d.video_url || "", error: d.error };
}

// Upload a client's selfie as a HeyGen Talking Photo → returns { talkingPhotoId }.
// Accepts an image URL (fetched server-side) or raw image bytes. The returned id becomes
// the per-client custom avatar passed to startHeyGenRender({ talkingPhotoId }).
export async function uploadTalkingPhoto(image) {
  const key = process.env.HEYGEN_API_KEY;
  if (!key) return { mock: true, talkingPhotoId: "", message: "Set HEYGEN_API_KEY." };

  let bytes, contentType = "image/jpeg";
  if (typeof image === "string") {
    const r = await fetch(toDirectAudioUrl(image)); // also normalizes Drive links for images
    if (!r.ok) throw new Error(`Could not fetch image (HTTP ${r.status})`);
    contentType = r.headers.get("content-type") || contentType;
    bytes = Buffer.from(await r.arrayBuffer());
  } else {
    bytes = image;
  }
  contentType = /png/i.test(contentType) ? "image/png" : "image/jpeg";

  const res = await fetch("https://upload.heygen.com/v1/talking_photo", {
    method: "POST",
    headers: { "X-Api-Key": key, "Content-Type": contentType },
    body: bytes,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Talking Photo upload failed: ${data.message || data.msg || res.status}`);
  const id = data.data?.talking_photo_id || data.data?.id || "";
  if (!id) throw new Error("No talking_photo_id returned by HeyGen");
  return { talkingPhotoId: id };
}
