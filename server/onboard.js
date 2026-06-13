const RENDER_API    = "https://api.render.com/v1";
const RENDER_OWNER  = "tea-d8moc09o3t8c73c2hprg";
const GITHUB_REPO   = "https://github.com/AndersonGlobalEnterprises/Runway";

export async function createClientService(opts) {
  const apiKey = process.env.RENDER_API_KEY;
  if (!apiKey) throw new Error("RENDER_API_KEY not set on this service");

  const {
    name, clientEmail, clientPassword, tier, company, clientName,
    voiceId, cta, color, audience, tone, product, destinations,
    logoUrl, phrasesUse, phrasesAvoid, website, squawk, templateId,
    stripePrices = {},
  } = opts;

  const sessionSecret = generateSecret();

  const envVars = [
    { key: "NODE_ENV",          value: "production"                    },
    { key: "SESSION_SECRET",    value: sessionSecret                   },
    { key: "ANTHROPIC_MODEL",   value: "claude-haiku-4-5-20251001"    },
    { key: "N8N_QUEUE_ENABLED", value: "true"                         },
    { key: "DEMO_LOGIN",        value: "false"                        },
    { key: "OWNER_MODE",        value: "false"                        },
    { key: "CLIENT_EMAIL",      value: clientEmail                    },
    { key: "CLIENT_PASSWORD",   value: clientPassword                 },
    { key: "CLIENT_COMPANY",    value: company                        },
    { key: "CLIENT_NAME",       value: clientName || company          },
    { key: "CLIENT_TIER",       value: tier || "starter"              },
    { key: "CLIENT_SQUAWK",     value: squawk                         },
    { key: "CLIENT_PRODUCT",    value: product || "Inspect"           },
    { key: "CLIENT_DESTINATIONS", value: (destinations || ["Instagram","TikTok","YouTube","LinkedIn"]).join(",") },
    { key: "CLIENT_CTA",        value: cta || ""                      },
    { key: "CLIENT_COLOR",      value: color || "#1e40af"             },
    { key: "CLIENT_AUDIENCE",   value: audience || ""                 },
    { key: "CLIENT_TONE",       value: tone || "direct"               },
    { key: "CLIENT_VOICE_ID",   value: voiceId || ""                  },
    { key: "CLIENT_LOGO_URL",   value: logoUrl || ""                  },
    { key: "CLIENT_WEBSITE",    value: website || ""                  },
    { key: "CLIENT_PHRASES_USE",   value: (phrasesUse || []).join(",")   },
    { key: "CLIENT_PHRASES_AVOID", value: (phrasesAvoid || []).join(",") },
    { key: "CLIENT_TEMPLATE_ID",   value: templateId || "856453b5-c707-488e-a8ae-0dc7d47a90bc" },
    { key: "ANTHROPIC_API_KEY",    value: process.env.ANTHROPIC_API_KEY  || "" },
    { key: "GEMINI_API_KEY",       value: process.env.GEMINI_API_KEY     || "" },
    { key: "AI_PROVIDER",          value: process.env.AI_PROVIDER        || "anthropic" },
    { key: "STRIPE_SECRET_KEY",    value: process.env.STRIPE_SECRET_KEY  || "" },
    { key: "CREATOMATE_API_KEY",   value: process.env.CREATOMATE_API_KEY || "" },
  ];

  for (const [k, v] of Object.entries(stripePrices)) {
    if (v) envVars.push({ key: k, value: v });
  }

  const res = await fetch(`${RENDER_API}/services`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      type: "web_service",
      name,
      ownerId: RENDER_OWNER,
      repo: GITHUB_REPO,
      branch: "main",
      serviceDetails: {
        runtime: "node",
        plan: "free",
        healthCheckPath: "/",
        envSpecificDetails: {
          buildCommand: "npm install",
          startCommand: "npm start",
        },
      },
      envVars,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Render API ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  return {
    serviceId:    data.service.id,
    deployId:     data.deployId,
    url:          data.service.serviceDetails.url,
    dashboardUrl: data.service.dashboardUrl,
  };
}

function generateSecret() {
  const arr = new Uint8Array(32);
  for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}
