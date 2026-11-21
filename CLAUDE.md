# Sketch Canvas

A multiplayer drawing canvas. Friends draw together; when they hit Generate, the sketch goes through a
vision model that writes a structured brief, and the brief becomes the prompt for an image model.
The point of the project is AI engineering depth: structured outputs, context engineering, cost
control, evals and guardrails. The day-by-day plan is in the doc linked from README.md.

## Stack

- apps/web: Vite, React, TypeScript, Konva (react-konva), Yjs client (y-websocket)
- apps/server: Node, TypeScript, Hono for HTTP, `ws` + y-websocket utils for the Yjs sync
- Everything is TypeScript with `strict` on.

## Commands

- `pnpm install` at the repo root (pnpm workspaces, see pnpm-workspace.yaml)
- `pnpm dev` starts web (http://localhost:5173) and server (http://localhost:1234)
- `pnpm typecheck` must pass before any commit
- `pnpm build` builds the web app

## Rules for working in this repo

1. API keys stay on the server. Nothing in apps/web may read or embed a key.
2. Every model output is validated with zod before it is used (see apps/server/src/brief.ts).
3. Every paid call (vision or image) goes through one wrapper that logs to `cost-log.jsonl` via
   `logCost` in apps/server/src/cost.ts. No paid call may bypass it.
4. Development uses the cheapest image tier. Higher tiers only for the evals.
5. Keep functions small and typed. No `any` without a comment saying why.
6. Do not add dependencies without saying why in the commit message.
7. Explain every change in plain language: what it does, why, and what could go wrong.

## Keep the door open for an instant mode

After the plan is done we may add an instant mode: while someone draws, AI refines that part
(image-to-image) and shows it on the canvas. Do not build any of it now, but do not make it hard:

1. Store generated images on the server. Yjs holds only a small record
   (`{ kind: 'image', url, x, y, w, h }`), never image bytes.
2. Shared canvas elements carry a `kind`. The renderer skips kinds it does not know instead of
   crashing, so older tabs survive new element types.
3. Never delete or flatten the original strokes. AI results go on top in their own layer; the
   strokes stay the source.
4. Sketch export takes an optional region (`exportSketch({ region? })`); no region = whole canvas.
5. Rule 3 covers instant mode too: every paid call goes through the one cost wrapper, which
   enforces the room budget.
6. The generation cache key includes mode, model and tier, not only the sketch and prompt.
7. A generation is a job with an id and a status (queued, running, done, failed), so a newer
   request can later cancel an older one.
8. Image calls go through one small function, e.g. `generateImage({ prompt?, image?, tier })`,
   so another model type is a new implementation, not a pipeline rewrite.

Not allowed: frameworks or abstractions built only for instant mode, rasterizing the drawing,
and hardcoding canvas dimensions outside `CANVAS_WIDTH` / `CANVAS_HEIGHT`.

## Working agreement

At the end of each phase of the plan, and before merging anything, run the reviewer agent
(`.claude/agents/reviewer.md`) on the changes and address its findings or explain why not.
