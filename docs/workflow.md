# Execution workflow — The Block

Build plan for Claude Code. Solo operator, subagent-parallelized where dependencies allow.

**Today:** Sep 1, 2026
**Deadline:** Sep 14, 5:00pm PDT = **Sep 15, 7:00am WIB**
**Working days:** 13, plus a WIB morning buffer on the 15th. Do not plan to use the buffer.

**Stack (v2):** single Next.js app, Strands Agents TypeScript SDK, hosted serverless DB, deployed to Vercel. See `architecture.md`.

---

## 0. How to read this

Parallelism has a hard prerequisite: **the interfaces between components must be pinned before subagents can work independently.** If the event schema isn't frozen, the agent subagent and the frontend subagent will build against different assumptions and you'll spend a day reconciling them.

Shape: **sequential spine (days 1–2) → wide parallel (days 3–7) → integration and polish (days 8–13).** Don't fan out early. The temptation to launch six subagents on day one is exactly how solo builds end up with six half-finished branches.

Every phase ends with a **review gate**. Gates are not optional and are not self-graded by the subagent that did the work.

**What the Next.js consolidation changed:** integration got much cheaper (one deployable, shared types, no CORS), so Phase 2 shrank from two days to one and that day moved into demo prep. SA-4's scope shrank to Slack, AWS access, and one Vercel project. The risk didn't disappear though, it *moved* — from "wiring two services together" to "serverless runtime limits." Hence the new day-5 deployed-runtime checkpoint.

## 1. Subagent roster

Six roles. Not all active at once.

| ID | Role | Owns | Never touches |
|----|------|------|---------------|
| **SA-1** | Agent core | `lib/agent/`, tools, prompts, the decide step | Components, hosting |
| **SA-2** | Memory & data | `lib/db/`, schema, `lib/seed.ts`, retrieval, `reflection.ts` | Components, Slack |
| **SA-3** | Frontend | `app/page.tsx`, `components/`, r3f scene, digest | Agent logic, DB writes |
| **SA-4** | Integrations | Slack app, AWS/Bedrock access, DB provisioning, Vercel | Business logic |
| **SA-5** | Reviewer | Adversarial review at every gate. Writes no feature code. | Everything (read-only) |
| **SA-6** | Submission | README, architecture diagram, description, video script | Source code |

**SA-5 is the important one.** A subagent that grades its own work passes it. Keep the role clean: SA-5 reviews, never implements. It files findings; the owning subagent fixes them.

**Shared-repo hazard:** one Next.js app means SA-1, SA-2 and SA-3 are now editing the same tree instead of separate services. Give each a branch, keep the ownership boundaries in the table above strict, and rebase daily. This is the one cost of consolidating.

## 2. Phase plan

### Phase 0 — Spike and pin (Days 1–2) · sequential, no parallelism

The goal isn't to build the product. It's to find the walls and freeze the contracts.

**Day 1**
- SA-4: register the Slack app, get a bot token posting to a test channel. **First thing.** OAuth setup is wall-clock time that doesn't compress.
- SA-4: AWS Builder ID, Bedrock model access, $50 credits via the Resources tab.
- SA-4: provision the DB (Turso or Neon — pick one, don't revisit).
- SA-1: `npx create-next-app`, install `@strands-agents/sdk`, one trivial Zod-schema tool, one successful Bedrock call from a route handler. Nothing else. Learn the SDK's actual shape before designing against it.

**Day 2**
- SA-2: freeze `lib/db/schema.sql` per `architecture.md` §3.2. Push to the hosted DB.
- SA-2: write `lib/seed.ts` with the planted pattern (Saturday 9am degrading over 6 weeks as two regulars drift off). Design the signal before building the detector.
- Pin the `/api/state` response shape. Commit it as a **TypeScript type** in `lib/types.ts` — with one language, the contract is enforced by the compiler instead of living in a README. Use that.
- SA-4: first deploy to Vercel. Empty app is fine. Prove the pipeline exists on day 2, not day 12.

> **GATE 0** — SA-5 verifies: Slack message actually sent? Bedrock call actually returned *from a deployed route handler, not just localhost*? Schema frozen and pushed? `/api/state` type committed? Vercel URL live?
> **If Slack isn't working by end of Day 3, invoke the outbox fallback** (`architecture.md` §3.5) and stop spending time on it.

### Phase 1 — Parallel build (Days 3–7) · four subagents concurrent

All four work against frozen contracts. Separate branches.

**SA-1 — agent core**
- Implement the five tools with Zod schemas
- Implement the loop: observe → retrieve → decide → act → log
- Use the SDK's structured output for the decide step — Zod validation with automatic retry on invalid output is free reliability on the one path that can't fail on camera
- The decide step is a real model call with retrieved context. Not a ranking function with a model sprinkled on top. Most heavily judged code in the repo.
- Capture the reasoning trace into the event log — demo asset

**SA-2 — memory and reflection**
- Simple retrieval first (filter → recency sort → cap). Ship it. Scoring function is stretch S2.
- `reflection.ts`: structured output, `source_event_ids` populated for provenance
- Set `maxDuration` on the reflection route from the first commit, not as a later fix
- Tune against seeded data until it reliably surfaces the planted Saturday pattern
- `lib/db/derive.ts`: events → plot stage, points, streaks. Pure functions, no stored state.

**SA-3 — frontend**
- Scene scaffold, growth stages 0–4, palette and type from `design.md`
- Entry overlay per `design.md` §5, including the "Run the agent" button
- Build against the committed `/api/state` **type** with a local fixture. Do not wait for the backend.
- Digest panel with expandable event provenance

**SA-4 — integrations**
- Env/secrets wired in Vercel
- `vercel.json` cron config
- Standing job: keep `main` deploying green

> **GATE 1 (Day 5) — deployed runtime checkpoint. New, and the most important addition of the stack change.**
> Run the reflection job **on the deployed URL** against a full seeded event batch. Does it complete inside the function limit?
> If it times out, fix it now per `architecture.md` §3.4 (bound the batch, chunk per slot, or move that one job off serverless). Discovering this on day 12 ends the project.

> **GATE 1B (Day 7)** — SA-5 reviews each stream against `prd.md` §5.1. Specifically: is the decide step genuinely agentic, or a template with a filter in front? Be harsh. Report per feature: shipped / partial / not started.

### Phase 2 — Integration (Day 8) · sequential, all hands

One day, not two — shared types and a single deployable remove most of the reconciliation work.

- Merge branches, replace frontend fixtures with live `/api/state`
- Add `/api/trigger/loop` and `/api/trigger/reflect` (demo controls)
- Run the full path end to end **on the deployed URL**: trigger → agent decides → Slack fires → event logged → block updates
- If it lands early, the remaining time goes to Phase 3, not to new features

> **GATE 2 (End of Day 8) — the hard one.**
> Can you run the entire flow, on the deployed URL, with nothing stubbed, while someone watches?
>
> **If no: stop building features. Cut per `design.md` §9 until yes.** Everything after this assumes a working end-to-end demo exists. A polished feature attached to a broken flow scores nothing.

### Phase 3 — Demo and submission (Days 9–12)

The video is a deliverable with its own days, not a Sunday-night afterthought. Presentation is a full judging criterion, and this stack change bought you an extra day here — spend it on the video, not on scope.

**Day 9**
- SA-6: video script. Must explicitly cover (1) the problem (2) who it's for (3) why it matters. Then the end-to-end demo.
- Suggested arc: raw event log (unreadable, that's the point) → reflection surfaces the pattern → agent decides who to ask and why → Slack fires → block lights up.
- Rehearse the live run. Know exactly which buttons you press.

**Day 10**
- Record. Multiple takes. Screen recording plus voiceover; no need to appear on camera.
- SA-6: README with real setup instructions and an honest limitations section (seeded data — say so).
- Architecture diagram exported to `docs/`.

**Day 11**
- Edit to under 5:00. Hard limit.
- MIT license committed **and visible in the repo About section**. Explicitly required, easy to forget.
- Devpost submission drafted with every field filled.

**Day 12**
- Buffer for overrun on any of the above. If clear: bonus builder.aws.com post with "Agents for Humans" in the title.

> **GATE 3** — SA-5 runs the deliverables checklist from `prd.md` §9 line by line. Also: does the video actually *state* problem/who/why in words, or assume the viewer infers it? Watch it once with the sound off, once with the screen off.

### Phase 4 — Stretch (Day 13)

Only if everything above is genuinely finished:

1. S1: AgentCore deployment (strengthens Technical Implementation)
2. S3: two-way Slack replies
3. S2: full retrieval scoring
4. S4: garden/streak details

**Submit by end of Day 12.** Then improve and resubmit if the platform allows edits. Do not have an unsubmitted project on Day 13.

## 3. Review protocol

At every gate, SA-5 answers in writing:

1. **Does it run?** Not "is the code written." Executed, output observed, **on the deployed URL** where applicable.
2. **Is anything faked?** Any stub, mock, or hardcoded value on the demo path is a defect. Name it.
3. **Would a judge call this trivial?** Especially the decide step. If the agent isn't reasoning, the top-weighted criterion fails.
4. **What's the honest completion state?** Per feature: shipped / partial / not started. No optimistic rounding.
5. **What should be cut?** Every gate is a chance to reduce scope, not just check progress.

Findings go to the owning subagent. SA-5 does not fix its own findings.

## 4. Standing rules

- **Commit after every meaningful unit.** Small, logical commits with Conventional Commit titles. Twelve days in one commit is unreviewable and looks bad in a public repo judges will open.
- **`main` stays deployable.** With one deployable, a broken merge breaks everything at once. That's the tradeoff for the simpler architecture — respect it.
- **The demo path is sacred.** Any change that breaks end-to-end gets reverted immediately, whatever it was going to enable.
- **Nothing faked on camera.** If it doesn't run, it doesn't go in the video. A judge who spots a seam discounts everything else.
- **Local success is not success.** This stack's failure mode is runtime limits in production. "It works" means it works deployed.
- **Seeded data gets disclosed.** README and video. Honesty about synthetic inputs beats a discovered fudge.
- **When behind, cut features, never the video.** Presentation is a full criterion. A great demo of a modest build beats a silent link to an ambitious one.

## 5. Daily loop

1. Name the one thing that must be true by tonight
2. Dispatch only the subagents that phase actually needs
3. End of day: does the end-to-end path still run **on the deployed URL**?
4. If it doesn't, tomorrow's only job is making it run again

## 6. Kill criteria

Honest triggers for cutting scope, decided in advance so they're not negotiated at 2am under pressure.

| Date | If this isn't true | Do this |
|------|-------------------|---------|
| End Day 2 | Vercel deploy pipeline works | Stop everything until it does. Nothing downstream matters. |
| End Day 3 | Slack posting works | Switch to outbox fallback, stop spending time on it |
| End Day 5 | Reflection job completes on the deployed URL | Bound the batch, chunk it, or move that job off serverless. Fix before building more. |
| End Day 7 | Agent loop runs end to end locally | Cut the 3D scene to a 2D grid, reassign SA-3 |
| End Day 8 | Full flow works deployed | Feature freeze. Everything into making it work. |
| End Day 10 | Video is recorded | Cancel all remaining polish |
