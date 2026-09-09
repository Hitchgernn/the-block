# PRD — The Block

**Project codename:** The Block
**Hackathon:** Agents for Humans (AWS / Strands Agents SDK), Good Neighbor Agents track
**Submission deadline:** Sep 14, 2026, 5:00pm PDT (= Sep 15, 7:00am WIB)
**Team:** Solo
**Status:** Draft v1

---

## 1. Background

The Good Neighbor Agents track asks for an agent that helps *groups* of people — neighborhoods, nonprofits, food banks, schools, small local orgs — rather than a single user. The hackathon's framing is explicit: the agent should run autonomously in the background and only surface when there's a real decision to make.

Food bank volunteer coordination is a good fit because the coordination burden is real, recurring, and unglamorous, and because the failure mode is concrete: fewer hands means less food distributed.

**Architectural influence:** the memory/reflection loop from Park et al., *Generative Agents: Interactive Simulacra of Human Behavior* (arXiv:2304.03442). That paper used a memory stream + retrieval + reflection architecture to make simulated characters behave believably. We borrow the architecture and point it at **real logged activity from real people** instead of synthetic agents. This distinction matters and should be stated explicitly in the pitch — we are not building a neighborhood simulation.

## 2. Problem

Volunteer coordinators at food banks fill shifts manually: spreadsheets, group texts, or scheduling software that handles sign-up and timed reminders but nothing else.

The gap is not scheduling. Scheduling is solved — Volgistics, VolunteerHub, Giveffect, Voluntarius and others all do self-serve sign-up, waitlists, and automated reminders. **The gap is pattern recognition and proactive recruiting.**

Existing tools are reactive. They fire reminders on a timer and let volunteers self-serve. What they don't do:

- Notice that a specific slot has been chronically short for weeks before it becomes a crisis
- Distinguish "who signed up" from "who actually showed up"
- Decide *who specifically* to ask for a given gap, based on history
- Re-engage volunteers who are quietly drifting away

Industry best-practice guides tell coordinators to track no-show patterns by day, time, and role and to over-recruit for historically unreliable shifts — as a **manual** task a human is supposed to remember to do. Nobody has time. That's the work we're automating.

**One-line problem statement:**
> Food bank coordinators find out a shift is short on the day it runs, because nothing is watching the pattern that made it predictable weeks earlier.

## 3. Who it's for

**Primary user: the volunteer coordinator.** Small-to-mid-size food pantry. Frequently part-time, or a volunteer themselves. Manages 30–150 volunteers across recurring weekly shifts. Their scarce resource is attention, not information.

**Secondary user: the volunteer.** Shows up sporadically or weekly. Wants to help, forgets, drops off quietly. Does not want another app to log into.

**Explicit non-user:** the food bank client. This product does not touch service recipients, does not gamify hunger, and does not make decisions affecting who receives food.

## 4. Why it matters

An understaffed shift isn't a shift that's "a bit short." A distribution planned around twelve volunteers and run with eight is operating at the wrong ratio of hands to food to clients. Programming runs short. The line moves slower. Less food moves.

The chain is direct: **coordination failure → understaffed shift → less food distributed.** That's the sentence the demo video needs to land.

## 5. What we're building

An autonomous agent that watches shift coverage, remembers what happened, reasons about patterns, and proactively recruits the right people — plus a shared visual layer that reflects real community activity back to volunteers.

### 5.1 Core features (must ship)

| # | Feature | Why it's in scope |
|---|---------|-------------------|
| F1 | **Agent core loop** — detect at-risk shift → retrieve relevant memory → select who to ask → notify → log outcome | This *is* the product. Directly scores Technological Implementation. |
| F2 | **Memory store** — append-only log of every event: shift filled, shift missed, ask sent, response received, no-show recorded | Foundation for everything else. Distinguishes signed-up from showed-up. |
| F3 | **Reflection job** — periodic pass that summarizes raw events into higher-level insights ("Saturday AM has run short 4 of last 6 weeks"; "3 volunteers inactive 3+ weeks") | The differentiator vs. existing scheduling tools. Strongest single technical showpiece. |
| F4 | **Targeted notifier** — messages specific volunteers via Slack, not a mass blast | Demonstrates the agent made a *decision*, not a broadcast. |
| F5 | **The Block (3D view)** — web-based low-poly neighborhood where each volunteer's plot develops as they complete real shifts | Design score + gamification/retention layer. |
| F6 | **Coordinator digest** — short surfaced summary of what the agent noticed and did | Closes the loop; proves autonomy without a babysat dashboard. |

### 5.2 Stretch (only if core is done and polished)

- S1: Amazon Bedrock AgentCore deployment (explicitly optional per rules, but strengthens Technical Implementation)
- S2: Full recency + importance + relevance retrieval scoring per the Generative Agents paper (core ships with simpler retrieval)
- S3: Two-way Slack interaction (volunteer replies "yes" in-thread and the agent parses it)
- S4: Streak details in the 3D scene (gardens, rooftop plantings)

### 5.3 Explicitly out of scope

- Native mobile app. Web only. Slack handles mobile delivery for free.
- Real production integration with a live food bank's systems. Demo runs on seeded realistic data; **agent logic is real, the data feeding it is seeded.** State this honestly in the README.
- Auth, multi-tenancy, user accounts, admin panels.
- SMS/Twilio. Account verification alone eats days.
- Anything touching food bank clients or beneficiary data.

## 6. Product surfaces

**One responsive Next.js app, one live URL, deployed to Vercel.** The rules state a live demo link strengthens Technical Implementation — this is why it's a hard requirement, not a nice-to-have.

- **Volunteer surface:** The Block. 3D view, ambient, glanceable. Also serves as the leaderboard.
- **Coordinator surface:** minimal read-only digest — what the agent noticed, who it asked, what's still open.
- **Notification surface:** Slack. Volunteers already have it on their phones.

## 7. Gamification design constraints

The game layer sits on the **volunteer participation** layer, not on the human need underneath it. Points are for showing up to a shift, never for anything touching food recipients.

**Tone: warm and celebratory, not competitive or guilt-driven.**

- Reference tone: Animal Crossing / Habitica — grow something, celebrate what happened
- Anti-reference: Duolingo streak-loss anxiety. Nobody should feel punished for missing a food bank shift because life happened.
- Missing a week must never produce a visual *penalty*. Growth pauses; nothing burns down. Empty lots are an invitation, not a scolding.

If a mechanic makes a volunteer feel bad for having a hard week, cut it.

## 8. Success criteria

Mapped to the five judging criteria:

| Criterion | What "done" looks like |
|-----------|------------------------|
| Technological Implementation | Real Strands agent, non-trivial multi-tool loop, live demo URL, working reflection pass. Live URL published. |
| Design | Coherent end-to-end product, not a proof of concept. Coordinator and volunteer surfaces both real and both reading from the same store. |
| Potential Impact | Specific named audience, specific named problem, clear line from the agent's action to more food distributed. |
| Creativity & Originality | Memory + reflection architecture adapted from published research; clearly articulated wedge vs. existing scheduling tools. |
| Presentation | ≤5 min video covering problem / who / why + end-to-end working demo. No seams, no faked state. |

**Personal bar:** every single thing shown on camera actually runs. No mockups presented as working software.

## 9. Deliverables checklist (from the rules)

- [ ] Text description: what it does, who it's for, how it works
- [ ] Public code repo, MIT or Apache license **visible in the repo About section**
- [ ] README with full setup instructions
- [ ] Architecture diagram
- [ ] Demo video, max 5 minutes, covering (1) problem (2) who it's for (3) why it matters
- [ ] AWS Builder ID
- [ ] Live demo link (optional but scores higher — treat as required)
- [ ] Bonus: builder.aws.com post with "Agents for Humans" in the title

## 10. Key risks

| Risk | Mitigation |
|------|-----------|
| 13 days, solo, four workstreams | Ruthless scope. Core loop first, 3D last. See workflow.md gates. |
| "This is just a scheduling app" | Lead the pitch with the pattern-recognition wedge, not the scheduling. Name the incumbents and say what they don't do. |
| 3D eats all the time | Volunteer plots stay primitives generated from data. Scenery comes from a finished CC0 pack rather than being modelled — see `design.md` §4. Hard timebox. If it slips, ship a 2D block grid instead — the agent is what's judged. |
| Strands SDK learning curve | Day 1 is a spike, nothing else. Find the walls before committing to a design. |
| Demo video left to the last day | Video is a scheduled deliverable with its own days, not a Sunday-night afterthought. |
| Seeded data reads as fake | Be upfront in README and video. Seeded *inputs*, real *logic*. Honesty scores better than a discovered fudge. |
