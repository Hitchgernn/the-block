# Architecture — The Block

Companion to `prd.md`. Describes how the system is built and why.

**Stack decision (v2):** single Next.js application using the Strands Agents **TypeScript** SDK. One language, one repo, one deployable. Supersedes the earlier Python + FastAPI split.

---

## 1. Design principles

1. **One source of truth.** Every surface reads from the same event store. There is no separate mock data path for the 3D view. If the scene shows a building, an event caused it.
2. **The agent decides, tools execute.** Notification, scoring, and persistence are tools. Reasoning lives in the agent.
3. **Append-only events.** Nothing is mutated. Current state is derived. This makes the reflection pass trivial and the demo reproducible.
4. **Degrade, don't break.** If the model call fails, the loop logs and continues. A demo that crashes on camera is worse than one that skips a step.
5. **One deployable.** Any proposal that adds a second service needs to justify itself against 13 solo days.

## 2. System overview

```
┌────────────────────────────────────────────────┐
│           NEXT.JS APPLICATION                   │
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │  Route handlers  (app/api/*)             │  │
│  │                                          │  │
│  │  AGENT CORE — Strands Agents TS SDK      │  │
│  │  observe → retrieve → decide → act → log │  │
│  │                                          │  │
│  │  Tools (Zod-schema'd):                   │  │
│  │   • getShiftStatus                       │  │
│  │   • queryMemory                          │  │
│  │   • sendAsk        (Slack)               │  │
│  │   • logEvent                             │  │
│  │   • awardPoints                          │  │
│  │                                          │  │
│  │  REFLECTION JOB — batch summarize        │  │
│  └───────────────┬──────────────────────────┘  │
│                  │                              │
│  ┌───────────────▼──────────────────────────┐  │
│  │  App router pages                        │  │
│  │   • The Block (3D, react-three-fiber)    │  │
│  │   • Coordinator digest                   │  │
│  └──────────────────────────────────────────┘  │
└──────────┬───────────────────────┬─────────────┘
           │                       │
           ▼                       ▼
   ┌───────────────┐      ┌─────────────────┐
   │  TURSO / NEON │      │      SLACK      │
   │  events[]     │      │  targeted asks  │
   │  reflections[]│      │  digest         │
   │  volunteers[] │      └─────────────────┘
   └───────────────┘
                          ┌─────────────────┐
                          │ AMAZON BEDROCK  │
                          │ (Strands default│
                          │  model provider)│
                          └─────────────────┘
```

## 3. Components

### 3.1 Agent core (Strands Agents TypeScript SDK)

Lives in `lib/agent/`, invoked from route handlers. Runs on a schedule (Vercel Cron) and on manual trigger for demos.

**Loop:**

1. **Observe** — `getShiftStatus`. Which upcoming shifts are below minimum coverage?
2. **Retrieve** — `queryMemory` for context relevant to that gap: who has covered this slot before, who's reliable, who was asked recently, what reflections exist about this slot.
3. **Decide** — the model call. Given the gap and the retrieved context, pick *specific* volunteers and write a message appropriate to each.
4. **Act** — `sendAsk` for the chosen people.
5. **Log** — `logEvent` for everything, including the reasoning summary. The reasoning trace is a demo asset; capture it.

**Non-negotiable:** the decide step must be a real model call with retrieved context in the prompt, not a hardcoded ranking function. This is the most heavily judged code in the repo.

Tools are defined with Zod schemas, which the SDK uses for input validation and type inference. Use the SDK's **structured output** support for the decide step — it validates against a Zod schema and automatically retries with validation feedback when the model returns something invalid. That retry behavior is free reliability on the one code path that absolutely cannot fail on camera.

### 3.2 Data store

**Not SQLite-on-disk.** Serverless functions have an ephemeral filesystem — a `.db` file written by one invocation is gone by the next. This was wrong in v1 of this doc and would have failed on first deploy.

**Use a hosted serverless database:**

- **Turso** (libSQL — SQLite-compatible, so the schema below ports unchanged), or
- **Neon** / **Vercel Postgres**

Pick one on day 2 and don't revisit. Turso if you want the SQLite dialect; Neon if you'd rather have plain Postgres. Either is a five-minute setup.

Three tables:

**`events`** (append-only, the only thing the loop writes)

| field | type | notes |
|-------|------|-------|
| id | serial PK | |
| ts | timestamptz | when it happened |
| type | text | `shift_opened`, `ask_sent`, `ask_accepted`, `ask_declined`, `shift_completed`, `no_show`, `shift_short` |
| volunteer_id | text nullable | |
| shift_id | text nullable | |
| payload | jsonb | free-form detail |
| importance | int 1–5 | used by retrieval |

**`reflections`** (written only by the reflection job)

| field | type | notes |
|-------|------|-------|
| id | serial PK | |
| ts | timestamptz | |
| text | text | e.g. "Saturday 9am has run short 4 of the last 6 weeks" |
| source_event_ids | jsonb | provenance — lets you prove on camera it came from real events |
| kind | text | `pattern`, `person`, `risk` |

**`volunteers`** (reference data, seeded)
id, name, slack_handle, joined_at, preferred_slots.

**Derived, never stored:** points, streaks, plot growth stage, reliability. All computed from `events` on read. This guarantees the 3D view can't drift from reality.

Access via a thin query module (`lib/db/`). Drizzle or raw SQL both fine — don't spend time on an ORM decision.

### 3.3 Retrieval

Core ships with **simple retrieval**: filter events by relevance (same slot, same volunteer), sort by recency, cap at N, plus all recent reflections. That's enough.

Stretch (S2) is the Generative Agents scoring function:

```
score = α·recency + β·importance + γ·relevance
```

Only if core is finished and polished.

### 3.4 Reflection job

`app/api/cron/reflect/route.ts`, plus a manual trigger for demos.

1. Read events since last reflection
2. One model call with structured output: return `[{kind, text, source_event_ids}]`, Zod-validated
3. Write to `reflections`
4. Optionally push a digest to Slack

**This is the money shot for the demo.** Raw events in, genuinely non-obvious insight out, source events traceable.

**Serverless timeout risk — the main gotcha of this stack.** A long model call over a large event batch can exceed the function execution limit. Mitigations, all cheap, all applied from the start:

- Set `export const maxDuration` explicitly on the route
- Keep the reflection batch bounded (last ~100 events, not all history)
- **Test the reflection route on the deployed URL by day 5**, not just locally. "Works local, times out in prod" discovered on day 12 is a project-ending bug.

If it still times out: split reflection into per-slot chunks across several invocations, or move just this job to a non-serverless host. Don't restructure the whole app for it.

### 3.5 Notifier tool

Slack via `chat.postMessage`. One workspace, a couple of channels, bot token in env.

Register the Slack app on **day 1**. OAuth and workspace setup is wall-clock time that doesn't compress no matter how fast you code.

Fallback if Slack stalls: write messages to an `outbox` table and render them in the app as a simulated inbox. Less impressive, still honest, unblocks everything downstream. **Decide by end of day 3.**

### 3.6 Frontend

Same Next.js app, app router.

- **3D:** `react-three-fiber` + `drei`. Primitive geometry only — `boxGeometry`, `cylinderGeometry`, `coneGeometry`, `planeGeometry`. No GLTF, no textures.
- **Data:** server components fetch derived state directly; the client polls a route handler for live updates during the demo.
- **Views:** The Block (default) and a coordinator digest panel.

### 3.7 Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/` | page | The Block |
| `/api/state` | GET | Derived world state for the 3D view |
| `/api/digest` | GET | Recent reflections + agent actions |
| `/api/events` | GET | Raw event log — used on camera to prove provenance |
| `/api/cron/loop` | GET | Scheduled agent loop (Vercel Cron) |
| `/api/cron/reflect` | GET | Scheduled reflection job |
| `/api/trigger/loop` | POST | Manual run — **for the live demo** |
| `/api/trigger/reflect` | POST | Manual run — **for the live demo** |

The manual triggers exist so the demo video shows the agent working on camera instead of waiting for a cron. They're a presentation asset; keep them.

Note: Vercel Cron on the free tier is limited in frequency. This barely matters — the demo runs off manual triggers, and cron only needs to prove the thing runs unattended.

## 4. Tech stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Agent | Strands Agents **TypeScript** SDK (`@strands-agents/sdk`) | Required by hackathon; TS keeps it one language |
| Model | Amazon Bedrock | Strands' default provider; $50 AWS credits apply |
| App | Next.js (App Router) | Agent + API + frontend in one deployable |
| Store | Turso or Neon | Serverless-compatible; **not** local SQLite |
| Validation | Zod | SDK-native for tools and structured output |
| 3D | react-three-fiber + drei | Primitives only |
| Notifications | Slack Web API | Volunteers already have it installed |
| Hosting | Vercel | One deploy, live URL, scores higher per rules |
| Deployment (stretch) | Bedrock AgentCore | Optional per rules; strengthens Technical Implementation |

**Why TypeScript over Python, honestly:** the Python SDK is more mature and has far more examples and community answers to crib from. TypeScript wins here anyway because collapsing two deployables into one removes the single biggest integration risk in a 13-day solo build. Accept that you'll occasionally be the first person to hit a given bug.

## 5. Repo layout

```
the-block/
├── LICENSE                       # MIT — must be visible in repo About
├── README.md
├── docs/
│   ├── prd.md
│   ├── architecture.md
│   ├── design.md
│   ├── workflow.md
│   └── architecture-diagram.png
├── app/
│   ├── page.tsx                  # The Block
│   ├── digest/page.tsx
│   └── api/
│       ├── state/route.ts
│       ├── digest/route.ts
│       ├── events/route.ts
│       ├── cron/
│       │   ├── loop/route.ts
│       │   └── reflect/route.ts
│       └── trigger/
│           ├── loop/route.ts
│           └── reflect/route.ts
├── lib/
│   ├── agent/
│   │   ├── core.ts               # Strands agent + loop
│   │   ├── reflection.ts
│   │   ├── prompts.ts
│   │   └── tools/
│   │       ├── shifts.ts
│   │       ├── memory.ts
│   │       ├── notify.ts
│   │       └── scoring.ts
│   ├── db/
│   │   ├── schema.sql
│   │   ├── queries.ts
│   │   └── derive.ts             # events → plot state, points, streaks
│   └── seed.ts                   # realistic seeded scenario
├── components/
│   ├── Block.tsx                 # r3f scene
│   ├── Plot.tsx
│   └── Digest.tsx
└── vercel.json                   # cron config
```

## 6. Demo data strategy

Seeded, but **realistic and narratively deliberate**. `lib/seed.ts` generates ~8 weeks of history for ~20 volunteers with a planted pattern the agent can actually discover — Saturday 9am quietly degrading over six weeks as two reliable regulars drift off.

The demo shows:
1. The raw event log (boring, human-unreadable — that's the point)
2. The reflection job running and surfacing the pattern
3. The agent loop deciding *who* to ask and why
4. The Slack message going out
5. The Block updating when the shift is covered

Design the seed data **before** building the reflection prompt, so there's a known-good signal to test against.

## 7. Known limitations (state these in the README)

- Runs on seeded data, not a live food bank integration. The agent logic is real; the inputs are synthetic.
- Single-tenant, no auth. Prototype scope.
- Reflection quality depends on event volume; sparse data yields thin insights.
- No handling of volunteer qualifications, waivers, or minors — real deployments would need these and they're deliberately out of scope.
