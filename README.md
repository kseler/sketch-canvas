# Sketch Canvas

A multiplayer drawing canvas that turns a sketch into an AI image. Friends draw together in a room;
when someone clicks Generate, a vision model writes a structured brief of the sketch, and the brief
becomes the prompt for an image model. Everyone in the room sees the picture.

Built as an AI engineering project: structured outputs, context engineering, cost control, evals
and guardrails.

Plan (Nov 20-30): https://claude.ai/artifact/KESXp5mW6EfHtRKp4BaW1N

## Run it

Needs Node 26 (see `.nvmrc`) and pnpm.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

- Web: http://localhost:5173 (the URL gets a room hash; open it in two browsers to draw together)
- Server: http://localhost:1234 (Yjs sync over WebSocket, plus `/api/*`)

The canvas works without any keys. For Generate, fill in `.env` at the repo root:

| Variable | What it does |
| --- | --- |
| `ANTHROPIC_API_KEY` | The sketch brief (Claude Haiku). Without it, Generate answers 503. |
| `IMAGE_API_KEY` | OpenAI key for the content check and the picture. Without it, Generate stops after the brief. |
| `DAILY_BUDGET_USD` | Spending cap for the whole server per UTC day (default $2). |
| `ROOM_BUDGET_USD` | Spending cap for one room per UTC day (default $0.50). |
| `ALLOWED_ORIGINS` | Pages allowed to call the API, comma-separated (default `http://localhost:5173`). |

Keys stay on the server and are never sent to the browser. Clicking Generate with real keys spends
real money (about $0.018 per picture at the dev tier).

## What works now

- **Drawing:** pen and eraser, six colors, three sizes, clear.
- **Multiplayer:** shared rooms by link, live strokes while they are drawn, cursors and names,
  people counted once even with several tabs open.
- **Generate:** exports the sketch as PNG and sends it to the server, which:
  1. checks the PNG and the request (size, origin, one generation per room at a time);
  2. asks Claude Haiku for a brief (subject, style, mood, palette, composition, lettering),
     validated with a JSON schema and zod, with any words from the sketch filtered;
  3. builds the image prompt from the brief and runs it through OpenAI's free moderation check,
     which fails closed;
  4. generates the picture with OpenAI's image model at the cheapest tier;
  5. stores the PNG on the server and adds a small record to the room's shared Yjs document, so
     every tab shows it in the panel beside the canvas.

  If any step fails, nothing after it runs and no picture is shared.
- **Cost control:** every paid call goes through one wrapper (`paidCall` in
  `apps/server/src/cost.ts`) that reserves the estimated cost against the daily caps before the
  call and logs the real cost to `apps/server/cost-log.jsonl` after it. Today's total is rebuilt
  from that log on startup, so a restart doesn't reset the caps.

## Layout

```
apps/web      React + Konva canvas, Yjs client, picture panel
apps/server   Hono HTTP, Yjs WebSocket sync, generate pipeline, cost wrapper and log
.claude/      Claude Code agents and the pre-commit hook
CLAUDE.md     project rules that Claude Code follows
```

Generated pictures are stored in `apps/server/data/images` (gitignored).

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm scan:bundle
```

`pnpm lint` is type-aware ESLint (typescript-eslint, React hooks). It also enforces the money and key
rules: only the AI wrappers may import an AI SDK, and the web app may not read a key-like `VITE_`
variable. `pnpm scan:bundle` checks the built web bundle for keys. CI runs all five on every PR and
push to main. New logic gets tests next
to its source (`foo.ts` → `foo.test.ts`, Vitest).

## Working with Claude Code

`CLAUDE.md` holds the rules Claude Code follows here: keys stay on the server, every model output
is validated with zod, and every paid call goes through the cost wrapper.

Agents in `.claude/agents/`:

- **reviewer**: read-only review of the latest changes for bugs, security problems, cost leaks
  and missing tests, grouped by severity. Run it at the end of each phase and before merging.
- **security-reviewer**: narrower read-only review for anything touching untrusted input, the
  WebSocket server, the generate endpoint or secrets.
- **test-writer**: drafts Vitest tests for existing code; writes only test files and reports bugs
  instead of fixing them.

In Claude Code, for example:

> Use the reviewer agent on my latest changes.

A hook (`.claude/hooks/check-before-commit.sh`) runs lint, typecheck and tests before Claude Code
commits.

## Next (planned)

- Generation as a job with a status, so everyone in the room sees "generating" while it runs.
- A cache, draft-then-final generation and a cost meter.
- Evals for the brief and the picture.
