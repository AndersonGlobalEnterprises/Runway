# Glif Visual Workflow (Runway)

**Why it's manual:** Glif shut off their API on 5/20/26, so no app can generate Glif images automatically. Your $30 Glif plan still works **inside glif.app** — so `runway-creative` does the thinking and hands you a ready-to-paste prompt; you run it in Glif.

> Note: Runway's default post graphics are **HTML→PNG** (the existing `graphics/<product>-<id>.html` + `.png` files), which ARE fully automated and need no Glif. Use Glif when you want a **generated/photoreal image** instead of a coded graphic.

## The 5 steps

1. **Ask `runway-creative`** for a flight or visual, e.g. *"make the Inspect P1 post image in Glif."*

2. **Agent gives you a Glif Prompt Pack** — shown in chat **and** saved to `glif-prompts/<name>.md`. Each image lists:
   - **PROMPT** — paste into Glif exactly (matches the post's message)
   - **MODEL** — which Glif image model to pick (Flux 2 Turbo, Nano Banana Pro, Seedream V4)
   - **SAVE AS** — exact filename + folder, always `graphics/<product>-<id>.png`

3. **Run each in Glif** at https://glif.app — paste, pick model, generate, download.

4. **Save** with the exact name from "SAVE AS" into the **`graphics/`** folder. Don't overwrite a graphic you've already approved — version it.

5. **Say "done"** — the agent places the image with the flight (status stays draft) and tells you to run **runway-review** before publishing.

## Tips
- The image must match the post's message — a strong image on the wrong claim fails runway-review.
- Want fully hands-free images? The HTML→PNG path already is; for AI images without pasting, Canva MCP (connected) or a raw image API can be wired — just ask.
