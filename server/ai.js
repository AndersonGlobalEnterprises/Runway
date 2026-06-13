import { appendApprovedHook, appendMemorySignal, getConfig } from "./db.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

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

async function anthropicMessages(system, user) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
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

export async function generateScript({ topic, notes }) {
  const system = `You write short-form social video scripts for B2B operators. Return JSON only with keys: hook, full_script, caption. No markdown fences.\n\n${brandContext()}`;
  const user = `Topic: ${topic}\nNotes: ${notes || "none"}\n\nWrite a 45-60 second script. Hook under 12 words. Caption under 220 chars with hashtags.`;

  const text = await anthropicMessages(system, user);
  if (text) {
    try {
      return JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
    } catch {
      return { hook: topic.slice(0, 80), full_script: text, caption: topic.slice(0, 180) };
    }
  }

  return fallbackScript(topic);
}

export async function rewriteScript({ hook, fullScript, caption, action, customPrompt }) {
  const actions = {
    shorter: "Make it shorter and punchier. Keep the same message.",
    direct: "Make it more direct and confident. Less fluff.",
    local: "Add a stronger local-market angle for homeowners.",
    cta: "Strengthen the call-to-action at the end.",
    hook: "Rewrite only the hook — keep body similar.",
    custom: customPrompt || "Improve the script.",
  };

  const instruction = actions[action] || actions.custom;
  const system = `You edit social video scripts. Return JSON with keys: hook, full_script, caption. No markdown.\n\n${brandContext()}`;
  const user = `Instruction: ${instruction}\n\nCurrent hook: ${hook || ""}\n\nScript:\n${fullScript || ""}\n\nCaption: ${caption || ""}`;

  const text = await anthropicMessages(system, user);
  if (text) {
    try {
      return JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
    } catch {
      return { hook, full_script: text, caption };
    }
  }

  return {
    hook: hook || "",
    full_script: (fullScript || "").slice(0, Math.max(200, (fullScript || "").length - 80)),
    caption: caption || "",
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

function fallbackScript(topic) {
  const cfg = getConfig();
  const cta = cfg.brand?.cta || "Book a free inspection";
  return {
    hook: `Think you know roof damage? Let's fix that.`,
    full_script: `Most homeowners miss the early signs of roof damage — and that gets expensive fast.\n\nHere's what to look for after a storm: lifted shingles, granules in the gutters, and soft spots when you walk the perimeter.\n\nIf you're not sure, don't guess. ${cta}.`,
    caption: `${topic.slice(0, 120)} #roofing #stormdamage #${(cfg.company || "local").replace(/\s+/g, "")}`,
  };
}

export function aiAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
