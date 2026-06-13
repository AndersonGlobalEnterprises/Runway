import { getConfig } from "./db.js";
import { listContentTypes } from "./content-types.js";

export function strategyAvailable() {
  return Boolean(process.env.PERPLEXITY_API_KEY);
}

export async function getWeeklyFlightPlan() {
  const config = getConfig();
  const types = listContentTypes().map((t) => t.label).join(", ");

  const prompt = `You are a social media strategist for ${config.company}, a ${config.brand?.vertical} business.
Audience: ${config.brand?.audience}
Platforms: ${(config.destinations || []).join(", ")}
Content types available: ${types}

Return JSON only with keys: summary, posts (array of {day, time, platform, contentType, topicIdea, rationale}), warnings (array of strings).
Base recommendations on current best practices for TikTok, Instagram Reels, YouTube Shorts, and LinkedIn in 2026.
Keep posts to 3-5 for the week. Times in America/Chicago. No markdown.`;

  const text = await perplexityAsk(prompt);
  if (text) {
    try {
      return { ...JSON.parse(text.replace(/^```json\s*|\s*```$/g, "")), source: "perplexity" };
    } catch {
      return { summary: text, posts: [], warnings: [], source: "perplexity" };
    }
  }

  return fallbackPlan(config);
}

export async function getPublishHints({ contentType, platforms }) {
  const config = getConfig();
  const prompt = `For a ${config.brand?.vertical} business posting "${contentType}" content to ${platforms?.join(", ") || "social media"}, return JSON only: { bestTimes: string[], format: string, spacing: string, hashtags: string[] } — current 2026 algorithm tips. Brief.`;

  const text = await perplexityAsk(prompt);
  if (text) {
    try {
      return JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
    } catch {
      return { bestTimes: [text], format: "reel", spacing: "", hashtags: [] };
    }
  }

  return {
    bestTimes: ["Tue & Thu 11:00 AM–1:00 PM", "Wed 9:00 AM for LinkedIn"],
    format: contentType === "storm-tip" ? "reel" : "reel",
    spacing: "Avoid back-to-back storm posts — mix myth-bust between urgency posts.",
    hashtags: ["#roofing", "#stormdamage", "#homeowner"],
  };
}

async function perplexityAsk(prompt) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return null;

  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.PERPLEXITY_MODEL || "sonar",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || null;
}

function fallbackPlan(config) {
  return {
    source: "fallback",
    summary: `Post 3–4 Inspect videos this week across ${(config.destinations || []).slice(0, 3).join(", ")}. Mix myth-bust and storm tips.`,
    posts: [
      { day: "Tuesday", time: "11:00 AM", platform: "TikTok", contentType: "myth-bust", topicIdea: "Roof myths after storms", rationale: "Mid-morning engagement for homeowners" },
      { day: "Thursday", time: "12:00 PM", platform: "Instagram", contentType: "storm-tip", topicIdea: "Signs of hail damage", rationale: "Lunch scroll peak" },
      { day: "Wednesday", time: "9:00 AM", platform: "LinkedIn", contentType: "storm-tip", topicIdea: "Insurance claim timeline", rationale: "B2B-local trust building" },
    ],
    warnings: ["Do not post two storm-tip videos on consecutive days.", "Lead with value before CTA on LinkedIn."],
  };
}
