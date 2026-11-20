# Sketch Canvas

A multiplayer drawing canvas that turns a finished sketch into an AI image. Built as an AI
engineering project: vision-model briefs with structured output, cost control, evals and guardrails.

Plan (Nov 20-30): https://claude.ai/artifact/KESXp5mW6EfHtRKp4BaW1N

## Run it

```bash
pnpm install
pnpm dev
```

- Web: http://localhost:5173 (the URL gets a room hash; open it in two browsers to draw together)
- Server: http://localhost:1234 (Yjs sync over WebSocket, plus `/api/*`)

Copy `.env.example` to `.env` before you add the generate pipeline.

## Layout

```
apps/web      React + Konva canvas, Yjs client
apps/server   Hono HTTP, Yjs WebSocket sync, brief schema, cost log
.claude/agents/reviewer.md   read-only reviewer agent
CLAUDE.md     project rules that Claude Code follows
```

## Working with the reviewer agent

At the end of each phase, in Claude Code run:

> Use the reviewer agent on my latest changes.

It reads the diff in a fresh context and reports bugs, security issues, cost leaks and missing
tests, grouped by severity. It cannot edit files. You decide what to fix.

## What works now

- Draw with six colors, clear the canvas, and see other players' finished strokes in real time.
- `POST /api/generate` is a stub that returns 501. Building it is the Nov 25-26 phase.

## Known gaps (planned)

- In-progress strokes are not streamed, only finished ones (Nov 22-24).
- No cursors or names yet (Nov 22-24).
- No generate pipeline, cache or cost meter yet (Nov 25-28).
