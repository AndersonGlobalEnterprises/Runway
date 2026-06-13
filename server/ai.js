import { appendApprovedHook, appendMemorySignal, getConfig } from "./db.js";
import { getContentType, resolveDeliveryMode, deliveryIncludesPost, deliveryIncludesVideo } from "./content-types.js";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const GEMINI_MODEL    = process.env.GEMINI_MODEL    || "gemini-2.0-flash";

function activeProvider() {
  if (process.env.AI_PROVIDER === "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.GEMINI_API_KEY)    return "gemini";
  return null;
}

function brandContext() {
  const cfg = getConfig();
  const b = cfg.brand || {};
  const mem = cfg.memory || {};
  const recentEdits = (mem.editSignals || [])
    .slice(0, 8)
    .map((s) => `- ${s.summary}`)
    .join("\n");
  const hooks = (mem.approvedHooks || []).slice(0, 5).join("\n- ");

  return `
Brand: ${cfg.company || cfg.clientName}
Audience: ${b.audience || ""}
Vertical: ${b.vertical || ""}
Tone: ${b.tone || ""}
Hook style: ${b.hookStyle || ""}
CTA: ${b.cta || ""}
Always use phrases like: ${(b.phrasesUse || []).join(", ")}
Never use: ${(b.phrasesAvoid || []).join(", ")}
${hooks ? `\nApproved hooks the client likes:\n- ${hooks}` : ""}
${recentEdits ? `\nRecent edit preferences:\n${recentEdits}` : ""}
`.trim();
}

async function callAI(system, user) {
  const provider = activeProvider();
  if (provider === "gemini") return geminiGenerate(system, user);
  if (provider === "anthropic") return anthropicMessages(system, user);
  return null;
}

async function anthropicMessages(system, user) {
  const key = process.env.ANTHROPIC_API_KEY;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic HTTP ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text?.trim() || "";
}

async function geminiGenerate(system, user) {
  const key = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${err.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
}

function resolveMode({ contentType, deliveryMode }) {
  const ct = contentType ? getContentType(contentType) : null;
  return resolveDeliveryMode(ct?.id || contentType || "myth-bust", deliveryMode);
}

function generationPrompt(mode, topic, notes) {
  const postKeys = deliveryIncludesPost(mode)
    ? "linkedInPost (up to 800 chars), facebookPost (up to 500 chars), xPost (max 280 chars), "
    : "";
  const scriptKeys = deliveryIncludesVideo(mode) ? "full_script (45-60 sec spoken), " : "";
  return `Topic: ${topic}\nNotes: ${notes || "none"}\nDelivery: ${mode}\n\nReturn JSON only with keys: hook, ${scriptKeys}caption, ${postKeys}hashtags. Hook under 12 words. Caption under 2200 chars. No markdown fences.`;
}

export async function generateScript({ topic, notes, contentType, deliveryMode }) {
  const mode = resolveMode({ contentType, deliveryMode });
  const kind = mode === "post" ? "social posts" : mode === "hybrid" ? "social posts and short-form video scripts" : "short-form social video scripts";
  const system = `You write ${kind} for B2B operators. Return JSON only. No markdown fences.\n\n${brandContext()}`;
  const user = generationPrompt(mode, topic, notes);

  const text = await callAI(system, user);
  if (text) {
    try {
      return JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
    } catch {
      return fallbackScript(topic, mode);
    }
  }

  return fallbackScript(topic, mode);
}

export async function rewriteScript({ hook, fullScript, caption, linkedInPost, facebookPost, xPost, action, customPrompt, deliveryMode, contentType }) {
  const mode = resolveMode({ contentType, deliveryMode });
  const actions = {
    shorter: "Make it shorter and punchier. Keep the same message.",
    direct: "Make it more direct and confident. Less fluff.",
    local: "Add a stronger local-market angle for homeowners.",
    cta: "Strengthen the call-to-action at the end.",
    hook: "Rewrite only the hook — keep body similar.",
    custom: customPrompt || "Improve the script.",
  };

  const instruction = actions[action] || actions.custom;
  const postBlock = deliveryIncludesPost(mode)
    ? `\nLinkedIn: ${linkedInPost || ""}\nFacebook: ${facebookPost || ""}\nX: ${xPost || ""}`
    : "";
  const system = `You edit social content. Return JSON with keys: hook, full_script, caption${deliveryIncludesPost(mode) ? ", linkedInPost, facebookPost, xPost" : ""}. No markdown.\n\n${brandContext()}`;
  const user = `Instruction: ${instruction}\n\nCurrent hook: ${hook || ""}\n\nScript:\n${fullScript || ""}\n\nCaption: ${caption || ""}${postBlock}`;

  const text = await callAI(system, user);
  if (text) {
    try {
      return JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
    } catch {
      return { hook, full_script: text, caption, linkedInPost, facebookPost, xPost };
    }
  }

  return {
    hook: hook || "",
    full_script: (fullScript || "").slice(0, Math.max(200, (fullScript || "").length - 80)),
    caption: caption || "",
    linkedInPost: linkedInPost || "",
    facebookPost: facebookPost || "",
    xPost: xPost || "",
  };
}

export function recordScriptEdit({ before, after, topic }) {
  const changes = [];
  if (before.hook !== after.hook) changes.push("hook style adjusted");
  if ((before.fullScript || "").length > (after.fullScript || "").length + 40) changes.push("prefers shorter scripts");
  if ((before.fullScript || "").length + 40 < (after.fullScript || "").length) changes.push("prefers more detail");
  if (after.hook && after.hook !== before.hook) appendApprovedHook(after.hook);

  const cfg = getConfig();
  const avoidHits = (cfg.brand?.phrasesAvoid || []).filter((p) =>
    (before.fullScript || "").toLowerCase().includes(p.toLowerCase()) &&
    !(after.fullScript || "").toLowerCase().includes(p.toLowerCase())
  );
  if (avoidHits.length) changes.push(`removed jargon: ${avoidHits.join(", ")}`);

  appendMemorySignal({
    topic: topic || "",
    summary: changes.length ? changes.join("; ") : "manual script edit saved",
    type: "script_edit",
  });

  return getConfig().memory;
}

function fallbackScript(topic, mode = "video") {
  const cfg = getConfig();
  const cta = cfg.brand?.cta || "Book a free inspection";
  const hook = "Think you know roof damage? Let's fix that.";
  const full_script = deliveryIncludesVideo(mode)
    ? `Most homeowners miss the early signs of roof damage — and that gets expensive fast.\n\nHere's what to look for after a storm: lifted shingles, granules in the gutters, and soft spots when you walk the perimeter.\n\nIf you're not sure, don't guess. ${cta}.`
    : "";
  const caption = `${topic.slice(0, 120)} #roofing #stormdamage #${(cfg.company || "local").replace(/\s+/g, "")}`;
  const postBody = `Most homeowners miss early roof damage signs after storms.\n\nLook for lifted shingles, granules in gutters, and soft spots along the edge.\n\n${cta}`;
  return {
    hook,
    full_script,
    caption,
    linkedInPost: deliveryIncludesPost(mode) ? postBody : undefined,
    facebookPost: deliveryIncludesPost(mode) ? postBody : undefined,
    xPost: deliveryIncludesPost(mode) ? postBody.slice(0, 280) : undefined,
  };
}

export function aiAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.GEMINI_API_KEY);
}

export function aiProviderName() {
  return activeProvider() || "none";
}
