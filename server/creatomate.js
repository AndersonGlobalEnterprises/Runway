const API_BASE = "https://api.creatomate.com/v2";

export function creatomateAvailable() {
  return Boolean(process.env.CREATOMATE_API_KEY);
}

async function waitForRender(renderId, maxMs = 120000) {
  const key = process.env.CREATOMATE_API_KEY;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const res = await fetch(`${API_BASE}/renders/${renderId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`Creatomate status HTTP ${res.status}`);
    const data = await res.json();
    if (data.status === "succeeded" && data.url) return data;
    if (data.status === "failed") throw new Error(data.error_message || "Render failed");
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error("Render timed out");
}

export async function createRender({ templateId, modifications, preview = false }) {
  if (!templateId) throw new Error("No Creatomate template ID — set in content type or Voice & brand");

  const key = process.env.CREATOMATE_API_KEY;
  if (!key) {
    return {
      mock: true,
      url: "",
      status: "mock",
      message: "Set CREATOMATE_API_KEY for real renders. Modifications saved.",
      modifications,
    };
  }

  const res = await fetch(`${API_BASE}/renders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      template_id: templateId,
      modifications,
      render_scale: preview ? 0.5 : 1,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Creatomate HTTP ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const render = Array.isArray(data) ? data[0] : data;
  if (render.url) return render;
  if (render.id) return waitForRender(render.id);
  return render;
}
