# AGE Runway

Done-for-you AI content pipeline. Voice clone, script generation, video rendering, and multi-platform publishing — automated end-to-end.

**Live product:** marketing site, scroll takeoff animation, pricing, cockpit Flight Deck portal (demo auth).

## What it does

1. Queue a topic
2. AI generates a script in your voice
3. ElevenLabs clones your voice for audio
4. Creatomate renders a branded video
5. Publishes to LinkedIn, Instagram, X — automatically

## Stack

| Layer | Tech |
|-------|------|
| Marketing + portal UI | HTML, CSS, vanilla JS |
| Server | Express 5, express-session |
| Pipeline (backend) | n8n Cloud, ElevenLabs, Creatomate, Upload-Post |

## Local dev

```bash
npm install
npm run dev
```

Open http://localhost:3000

| Page | URL |
|------|-----|
| Marketing home | `/` |
| Pricing | `/runway-pricing.html` |
| Portal login | `/runway-login.html` |
| Flight Deck | `/runway-dashboard.html` (requires login) |
| Forgot password | `/runway-forgot.html` |
| Post-checkout | `/runway-success.html` |

**Demo login:** `demo@agerunway.com` / `runway123`

Copy `.env.example` to `.env` and set `SESSION_SECRET` for local sessions.

## Repo layout

```
client/public/          HTML pages, css/, js/
server/index.js         Express server + API stubs
.cursor/rules/          Cursor design brief
render.yaml             One-click deploy to Render
```

## Deploy (Render)

1. Push this repo to GitHub (`AndersonGlobalEnterprises/Runway`).
2. [Render](https://render.com) → **New → Blueprint** → connect the repo (uses `render.yaml`).
3. Render sets `SESSION_SECRET` automatically. Confirm env vars:
   - `NODE_ENV=production`
   - `SESSION_SECRET` (generated)
   - `DEMO_LOGIN=true` (set `false` when real auth ships)
4. Deploy. Your URL will be `https://age-runway.onrender.com` (or your custom domain).

**Custom domain:** Render dashboard → service → Settings → Custom Domains → add e.g. `runway.ageflowops.com`.

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | Auto | Set by host (default 3000) |
| `NODE_ENV` | Yes (prod) | `production` on deploy |
| `SESSION_SECRET` | Yes (prod) | Long random string for cookies |
| `DEMO_LOGIN` | No | `false` disables demo credentials |

## Ship checklist

- [x] Marketing home + aviation takeoff scroll
- [x] Pricing, login, cockpit dashboard
- [x] Session auth + protected Flight Deck
- [x] Production cookies (`secure` in prod)
- [ ] Stripe checkout (`POST /api/runway/checkout`) — contact flow live; wire Stripe next
- [ ] Real auth + client database — replace demo login
- [ ] Custom domain + SSL on Render

## Post-ship next

1. Wire Stripe checkout on `/api/runway/checkout`
2. Replace demo login with real accounts
3. Point DNS to Render (or your host)
4. Set `DEMO_LOGIN=false` in production when ready
