# AGE Runway — Core Edit Spec (v1)

**Status:** Approved to build  
**Scope:** Inspect taxi track · First Flight Roofing · 2 content types · 16 edit fields  
**Client:** Omar Anderson / First Flight Roofing  
**Build target:** Flight drawer tabs (Script · Video · Publish)

---

## Goal

Give clients enough control to fix scripts and videos without opening Creatomate or breaking brand consistency. Cap at **16 fields** across three tabs for Core v1.

---

## Content types (Inspect only — Core v1)

| ID | Label | When to use | Creatomate template | Duration |
|----|-------|-------------|---------------------|----------|
| `myth-bust` | Myth bust | Correct a common homeowner misconception | `TPL_MYTH_BUST_916` *(replace with real ID)* | 30s |
| `storm-tip` | Storm tip | Seasonal urgency, inspection CTA | `TPL_STORM_TIP_916` *(replace with real ID)* | 45s |

**Queue rule:** Every new topic must pick a content type. Type drives template ID, default b-roll preset, and strategy hints (Perplexity phase 2).

Future types (not Core v1): `faq`, `before-after`, `local-authority`, `insurance-tip`.

---

## Flight drawer — 3 tabs

```
┌─────────────────────────────────────────┐
│  Flight detail · Myth bust              │
│  ●━━━●━━━●━━━○━━━○━━━○  Script Ready   │
├─────────────────────────────────────────┤
│  [ Script ]  [ Video ]  [ Publish ]     │
├─────────────────────────────────────────┤
│  … tab fields …                         │
├─────────────────────────────────────────┤
│  Save · Clear script · Clear video · Depart │
└─────────────────────────────────────────┘
```

---

## Tab 1 — Script (8 fields)

| # | Field ID | UI label | Type | Max | Source / sync | Sheet column |
|---|----------|----------|------|-----|---------------|--------------|
| 1 | `hook` | Hook | text | 80 chars | AI + manual | `hook` |
| 2 | `fullScript` | Full script | textarea | 1200 chars | AI + manual | `full_script` |
| 3 | `caption` | Caption | textarea | 220 chars | AI + manual | `caption` |
| 4 | `hashtags` | Hashtags | text | 120 chars | Parsed from caption or separate | `caption` *(append)* |
| 5 | `ctaLine` | Spoken CTA | text | 100 chars | Default from `brand.cta` | *(in script)* |
| 6 | `tone` | Tone | select | — | `direct` · `educational` · `urgent` | `notes` *(meta)* |
| 7 | `length` | Target length | select | — | `30s` · `45s` · `60s` | `notes` *(meta)* |
| 8 | `contentType` | Content type | select | — | `myth-bust` · `storm-tip` | `notes` *(meta)* |

**AI actions (buttons, not fields):** Shorter · More direct · Local angle · Stronger CTA · New hook · Generate script

**Clearance gate:** `Clear script` → status `Script Ready` → n8n continues to voice.

---

## Tab 2 — Video (5 fields)

Maps to Creatomate **modifications**. Element names must match your template editor exactly — update `data/content-types.json` when templates are finalized.

| # | Field ID | UI label | Type | Creatomate key | Sync from |
|---|----------|----------|------|----------------|-----------|
| 9 | `onScreenHook` | On-screen hook | text | `Hook-Text` | `hook` |
| 10 | `onScreenCta` | End card CTA | text | `CTA-Text` | `ctaLine` or `brand.cta` |
| 11 | `primaryColor` | Brand color | color | `Primary-Color` | `brand.primaryColor` |
| 12 | `logoUrl` | Logo | image URL | `Logo-Image` | `brand.logoUrl` |
| 13 | `templateVariant` | Layout | select | *(template_id)* | `contentType` → template map |

**Video actions (buttons):**

| Button | API | Behavior |
|--------|-----|----------|
| Preview render | `POST /flights/:id/render-preview` | Creatomate `render_scale: 0.5`, returns preview URL |
| Re-render final | `POST /flights/:id/render-final` | Full quality → updates `video_url` in sheet |
| Watch current | link | Opens existing `video_url` |

**Clearance gate:** `Clear video` → status `Approved`.

**Sync rule:** Saving Script tab pushes `hook` → `onScreenHook` and `ctaLine` → `onScreenCta` unless client overrode Video tab (track `videoFieldsOverridden` flag per flight).

---

## Tab 3 — Publish (3 fields)

| # | Field ID | UI label | Type | Options | Storage |
|---|----------|----------|------|---------|---------|
| 14 | `platforms` | Destinations | multi-select | IG · TikTok · YouTube · LinkedIn | `platforms` column + manifest override |
| 15 | `scheduledAt` | Departure time | datetime-local | Client timezone | `scheduled_at` + manifest override |
| 16 | `postFormat` | Post as | select | `reel` · `short` · `feed` · `story` | manifest override |

**Clearance gate:** `Depart now` → trigger publish pipeline + status `Published`.

**Strategy hints (read-only, Perplexity phase 2):** Suggested day/time and “don’t post two storm tips back-to-back” — display only in Core v1 build; wire in phase 2.

---

## Data model extensions

### Per-flight (`flights-local.json` + sheet meta)

```json
{
  "contentType": "myth-bust",
  "tone": "direct",
  "length": "30s",
  "ctaLine": "Call for a free inspection",
  "hashtags": "#roofing #stormdamage",
  "videoModifications": {
    "Hook-Text": "Think your roof is fine?",
    "CTA-Text": "Free inspection today",
    "Primary-Color": "#1e40af",
    "Logo-Image": "https://..."
  },
  "videoFieldsOverridden": false,
  "postFormat": "reel",
  "scheduledAt": "2026-06-16T14:00:00.000Z"
}
```

### Config (`data/config.json` + `data/content-types.json`)

- `brand.primaryColor` — default `#1e40af`
- `brand.logoUrl` — client logo CDN URL
- `contentTypes` — see `data/content-types.json`

---

## API routes to add (build checklist)

| Route | Purpose |
|-------|---------|
| `GET /flights/:id/edit` | Full edit payload (script + video + publish + type defaults) |
| `PATCH /flights/:id/edit` | Save any tab; sync script→video; update sheet |
| `POST /flights/:id/render-preview` | Creatomate preview render |
| `POST /flights/:id/render-final` | Creatomate final render + webhook/poll |
| `POST /flights/queue` | **Extend:** accept `contentType` per topic |

**Env vars:**

| Variable | Required for |
|----------|--------------|
| `ANTHROPIC_API_KEY` | Script AI |
| `CREATOMATE_API_KEY` | Video preview/final |
| `PERPLEXITY_API_KEY` | Strategy hints (phase 2) |

---

## Creatomate template checklist (you fill in)

Before Video tab goes live, name these elements in Creatomate and paste real template IDs into `data/content-types.json`:

- [ ] `Hook-Text` — dynamic text, max 2 lines
- [ ] `CTA-Text` — end card
- [ ] `Primary-Color` — fill/stroke color
- [ ] `Logo-Image` — image source URL
- [ ] `Voice-Audio` — bound to ElevenLabs URL from pipeline *(n8n, not client-edited in Core)*
- [ ] `Bg-Video-1` — locked b-roll preset per content type *(Extended v2)*

---

## n8n / sheet behavior

1. **Queue topic** webhook receives `contentType` in `notes` JSON or dedicated field.
2. **Generate Script** workflow reads `brand` brief from sheet client tab or Runway API *(future)*.
3. **Publish** workflow reads `video_url`, `platforms`, `scheduled_at` from sheet.
4. **Update Status** webhook accepts new fields: `hook`, `full_script`, `caption`, `video_modifications` *(JSON string)*.

---

## UI build order

1. Drawer tabs (Script · Video · Publish) — shell only
2. Script tab — add fields 4–8 + wire save
3. Queue modal — content type dropdown
4. Video tab — fields 9–13 + preview render (needs Creatomate key)
5. Publish tab — fields 14–16 + manifest PATCH
6. Sync logic script→video
7. Perplexity read-only hints on Publish tab *(phase 2)*

---

## Out of scope (Core v1)

- Creatomate Preview SDK (browser live edit)
- B-roll upload / swap
- A/B hook variants
- Talksmith / Interview Prep content types
- Drag-and-drop calendar
- Auto-approve rules enforced in n8n
- More than 2 content types

---

## Definition of done (Core v1)

- [ ] Client opens any Inspect flight → 3 tabs visible
- [ ] Can edit all 16 fields and save to sheet/local
- [ ] Content type on queue sets template for render
- [ ] Preview render returns watchable URL
- [ ] Clear script / Clear video / Depart gates work
- [ ] Script save updates AI memory
- [ ] First Flight Roofing used on 3+ real topics without ops intervention

---

## Your action items before code

1. Create 2 Creatomate templates (9:16) — myth bust + storm tip  
2. Name elements exactly as in `data/content-types.json`  
3. Paste real template IDs into that file  
4. Add `CREATOMATE_API_KEY` and `ANTHROPIC_API_KEY` to `.env`  
5. Confirm n8n Queue Topic workflow accepts `contentType` in payload  

When templates are named, say **“build Core Edit Spec”** and implementation starts from this doc + `data/content-types.json`.
