<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# The Block — project guide

Guidance for any coding agent working in this repository (Claude Code, Codex,
Gemini CLI). `CLAUDE.md` imports this file.

Everything above this line is managed by `next dev`; everything below is ours
and is preserved when that block is regenerated.

## What this is

"The Block" — a submission for the AWS *Agents for Humans* hackathon (Good Neighbor Agents track), deadline **Sep 14 2026**. An autonomous agent watches food-bank volunteer shift coverage, reflects on the event log to find patterns, and asks *specific* people to fill gaps. A 3D block visualises real volunteer activity.

**`docs/` is the specification, not background reading.** `prd.md` (what/who/why), `architecture.md` (how), `design.md` (visual + copy rules), `workflow.md` (13-day plan, gates, kill criteria). When code and docs disagree, that is a bug in one of them — resolve it, don't silently pick a side.

`docs/sdk-notes.md` is the **verified** Strands SDK API, transcribed from the installed `.d.ts` files. Trust it over training data. If something is missing, read `node_modules/@strands-agents/sdk/dist/src/**/*.d.ts` and update that file.

## Commands

```bash
npm run dev      # next dev
npm run build    # next build — must pass; the deploy target is Vercel
npm run lint     # eslint; currently clean, keep it that way
npx tsc --noEmit # typecheck
```

**There is no test suite.** Verification is done by running things: curl the routes against the seeded database, and screenshot the UI. Do not claim something works because it typechecks.

```bash
node scripts/db-push.mjs                      # apply lib/db/schema.sql (local file DB)
node --env-file=.env.local scripts/db-push.mjs # ...or to Turso
curl -X POST localhost:3000/api/dev/seed      # reseed the demo scenario (destructive)
node --env-file=.env.local scripts/slack-smoke.mjs
```

Seeding is a **route, not a script**, because production is Turso and Vercel gives you no shell — the same code path has to work in both places.

### Installing dependencies

Always `npm install --omit=optional`. `@strands-agents/sdk` declares 23 peer deps and an optional chain reaching `node-llama-cpp` with CUDA/Vulkan binaries — hundreds of MB, none of it needed for Bedrock. `.npmrc` pins `legacy-peer-deps=true`. Two "peer" deps are mandatory in practice and are direct dependencies: `@modelcontextprotocol/sdk` and `@opentelemetry/api` (both imported eagerly on the SDK's Node entry path).

`next.config.ts` sets `serverExternalPackages: ["@strands-agents/sdk"]`. Without it Turbopack statically resolves every SDK branch and the build fails on packages the app never calls.

## Architecture

### Append-only events; everything else is derived

`events` is the only table the agent loop writes to. **Points, streaks, plot growth stage, reliability and shift coverage are never stored** — `lib/db/derive.ts` computes them from the log on read. This is what guarantees the 3D scene cannot drift from reality: if the scene shows a building, an event caused it.

Shifts have no table either. They are derived from `shift_opened` events, and coverage is a count of `ask_accepted` / `shift_completed` minus `no_show`.

If you find yourself adding a column that caches a computed value, that is the wrong direction.

### `lib/types.ts` is a frozen contract

It holds the API response shapes **and** the event `payload` shapes. `AskSentPayload` and `AgentReasoningPayload` are written by the agent loop and read by `/api/digest`; if the loop stops writing them the coordinator surface silently loses the evidence that the agent decided rather than broadcast. Treat changes here as cross-cutting.

### The decide step

`lib/agent/core.ts` runs observe → retrieve → decide → act → log. The decide step **must be a real model call with retrieved context in the prompt**, using the SDK's `structuredOutputSchema` so invalid output auto-retries with validation feedback. It picks specific named volunteers and writes a per-person message. A ranking function with a model sprinkled on top fails the top-weighted judging criterion. There is deliberately **no heuristic fallback** — a fallback would present asks the model never made as if it had.

The five Zod tools live in `lib/agent/tools/`. `awardPoints` logs a `shift_completed` event and returns recomputed totals; it does not store points.

### Reflection

`lib/agent/reflection.ts` **pre-aggregates before the model call** — ~300 events collapse into a ~55-line per-slot-per-week brief. Do not paste raw event rows into a prompt. `aggregate()` and `renderBrief()` are exported separately from `runReflection()` so the brief can be inspected without spending a token (`GET /api/trigger/reflect` is a dry run).

`source_event_ids` must contain ids that actually exist: `/api/digest` resolves them and renders the raw events under each insight. That expansion is how the demo proves an insight came from logged events rather than an LLM writing a plausible sentence.

### Serverless limits are the known failure mode

Every route sets `export const maxDuration` explicitly and every model call works from a bounded batch. `architecture.md` §3.4 is blunt about this: "works local, times out in prod" discovered late ends the project. **Local success is not success** — verify on the deployed URL.

### Degrade, don't break

A failed model call or missing Slack token logs and continues. `/api/trigger/loop` returns **200 with `ok: false`** rather than a non-2xx, because a throw in the overlay's `fetch` would show a judge nothing at all. `sendAsk` falls back to writing the message to the event log with `delivered: false`.

### Route auth

`/api/trigger/*` is **deliberately unauthenticated** — `design.md` §5 puts a "Run the agent" button in front of judges who have no credentials. `/api/cron/*` and `/api/dev/seed` require `Authorization: Bearer ${CRON_SECRET}`.

### Database

Turso (libSQL) over HTTP in production; a local `file:` URL in development, same SQL dialect, nothing changes between them. The local file path needs the `@libsql/linux-x64-gnu` devDependency; remote HTTP needs no native binding.

## Design rules that are constraints, not taste

From `design.md`, and they are checked:

- **`--lamp` (#FFC94A) means exactly one thing: someone showed up.** Never a button, link, border or focus ring. Gold anywhere else breaks the metaphor and the scene stops being readable.
- Empty lots are `--stone-dim` — neutral, never darker or redder. **Inaction is never a visual penalty.** Growth pauses; nothing burns down, nothing regresses a stage.
- Copy: plain verbs, sentence case, warmth about people, no drama about gaps. "Saturday 9am is short two people." never "⚠️ CRITICAL COVERAGE ALERT". The interface rarely says a point total out loud — the building growing *is* the reward.
- No all-caps labels, no accent-coloured word in a headline, no eyebrow labels. `design.md` calls these the tells that make work read as generated.
- Text uses `--stone-quiet` (5.54:1 on `--dusk`), not `--stone-dim` (4.45:1, under the floor). `--stone-dim` stays exactly as specified for 3D geometry.

## Seeded data

`lib/seed.ts` is deterministic (fixed LCG seed). It plants one discoverable pattern: **Saturday 9am** runs 9, 9, 7 (minimum 6) then 5, 4, 3, 2, 3 — short five weeks running — because its two most reliable regulars, Maria Ocampo and James Whitfield, stop appearing after 2026-07-18. No other slot degrades. Tuesday 5pm dips one under in the oldest week and never again, so naming Saturday 9am is a real discrimination and not the only sentence available. `docs/sdk-notes.md` §8 has the full table; tune reflection prompts against it.

Seeded inputs, real logic. **Disclose this in the README and the video** (`prd.md` §10).

## Scene cost, measured

Measured at 25 volunteers, 1400x900:

| | |
|---|---|
| Draw calls per frame | **412** |
| ...of which the 25 plots | **~360** |
| ...of which all borrowed scenery | **~52** |

Roads, pavements, grass, some forty trees, lamps, benches, cars, twenty-six
skyline towers, the park and the food bank cost about fifty draw calls between
them, because every repeated asset goes through drei `<Instances>`. **Keep it
that way** — the same content drawn one mesh per placement would be several
hundred.

The plots are the expensive part and cannot be instanced: each is unique
geometry derived from one volunteer's history, and window emissive colour varies
per plot with quietness. Roughly 150 of their 360 calls are windows. If draw
calls ever need reducing, that is the only place worth looking — not the
scenery.

**Wall-clock frame time measured in headless Chromium is meaningless.** It runs
SwiftShader, a software rasteriser; the ~1000 ms/frame it reports says nothing
about a real GPU. Draw-call count is the number to watch, since it is
hardware-independent.

## Verifying the UI

The Playwright MCP is broken on this machine (it wants Chrome at `/opt/google/chrome/chrome`). Use the cached Playwright Chromium directly over CDP instead — Node 22 has a native `WebSocket`:

```bash
ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux/chrome | tail -1
# launch with --headless --no-sandbox --enable-unsafe-swiftshader --remote-debugging-port=PORT
# then fetch http://127.0.0.1:PORT/json/list and drive Page.navigate / Page.captureScreenshot
```

Chrome's `--screenshot` flag mishandles this page's `position: fixed` shell and renders the 3D scene as blank — **use `Page.captureScreenshot` over CDP**, or you will chase a bug that isn't there.

## Working agreements

- Commit convention is in `.claude/skills/commit-convention.md`: `feat(frontend): <message>`, **subject line only, no body**, plus the `Co-Authored-By` trailer. Scopes: `agent`, `db`, `frontend`, `integrations`, `docs`, `submission`.
- `main` stays deployable. One deployable means a broken merge breaks everything at once.
- **Nothing faked on camera.** Any stub, mock or hardcoded value on the demo path is a defect. If it doesn't run, it doesn't go in the video.
