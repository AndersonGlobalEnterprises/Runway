import { getConfig } from "./db.js";
import { listContentTypes } from "./content-types.js";

export function strategyAvailable() {
  return Boolean(process.env.PERPLEXITY_API_KEY);
}

export async function getWeeklyFlightPlan() {
  const config = getConfig();
  const types = listContentTypes().map((t) => `${t.label} (${t.defaultDeliveryMode || "video"})`).join(", ");

  const prompt = `You are a social media strategist for ${config.company}, a ${config.brand?.vertical} business.
Audience: ${config.brand?.audience}
Platforms: ${(config.destinations || []).join(", ")}
Content types available: ${types}

IMPORTANT: Balance text posts and short-form video equally — aim for a 50/50 mix across the week.
Text posts: LinkedIn, Facebook, X. Video: Instagram Reels, TikTok, YouTube Shorts.

Return JSON only with keys: summary, posts (array of {day, time, platform, contentType, format, topicIdea, rationale}), warnings (array of strings).
format must be "post" or "video" (use "video" for Reels/Shorts).
Keep 4-6 items for the week with roughly half post and half video. Times in America/Chicago. No markdown.`;

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

export async function getPublishHints({ contentType, platforms, deliveryMode }) {
  const config = getConfig();
  const mode = deliveryMode || "video";
  const prompt = `For a ${config.brand?.vertical} business posting "${contentType}" content (${mode} delivery) to ${platforms?.join(", ") || "social media"}, return JSON only: { bestTimes: string[], format: string, spacing: string, hashtags: string[] } — current 2026 algorithm tips. Brief.`;

  const text = await perplexityAsk(prompt);
  if (text) {
    try {
      return JSON.parse(text.replace(/^```json\s*|\s*```$/g, ""));
    } catch {
      return { bestTimes: [text], format: mode === "post" ? "feed" : "reel", spacing: "", hashtags: [] };
    }
  }

  const isPost = mode === "post";
  return {
    bestTimes: isPost
      ? ["Wed 9:00 AM for LinkedIn", "Thu 11:00 AM for Facebook", "Tue 1:00 PM for X"]
      : ["Tue & Thu 11:00 AM–1:00 PM", "Wed 9:00 AM for LinkedIn Reels"],
    format: isPost ? "feed" : contentType === "storm-tip" ? "reel" : "reel",
    spacing: isPost
      ? "Alternate post and video days — don't stack three text posts back-to-back."
      : "Avoid back-to-back storm posts — mix myth-bust between urgency posts.",
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
  const dest = (config.destinations || []).slice(0, 6).join(", ");
  return {
    source: "fallback",
    summary: `Balanced week: 3 text posts + 3 short videos across ${dest}. Mix myth-bust and storm tips on both formats.`,
    posts: [
      { day: "Monday", time: "9:00 AM", platform: "LinkedIn", contentType: "myth-bust-post", format: "post", topicIdea: "Roof myths after storms", rationale: "Thought leadership opener" },
      { day: "Tuesday", time: "11:00 AM", platform: "TikTok", contentType: "myth-bust", format: "video", topicIdea: "Roof myths after storms", rationale: "Same angle as video — mid-morning scroll" },
      { day: "Wednesday", time: "9:00 AM", platform: "Facebook", contentType: "storm-tip-post", format: "post", topicIdea: "Signs of hail damage", rationale: "Local homeowner feed" },
      { day: "Thursday", time: "12:00 PM", platform: "Instagram", contentType: "storm-tip", format: "video", topicIdea: "Signs of hail damage", rationale: "Visual storm damage works in Reels" },
      { day: "Friday", time: "1:00 PM", platform: "X", contentType: "myth-bust-post", format: "post", topicIdea: "Insurance claim timeline", rationale: "Quick tip format for X" },
      { day: "Saturday", time: "10:00 AM", platform: "YouTube", contentType: "myth-bust", format: "video", topicIdea: "Granules in the gutter", rationale: "Weekend Shorts discovery" },
    ],
    warnings: [
      "Keep post and video counts even — don't skip text posts for video-only weeks.",
      "Lead with value before CTA on LinkedIn and Facebook.",
    ],
  };
}
