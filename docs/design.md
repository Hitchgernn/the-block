# Design — The Block

Companion to `prd.md` and `architecture.md`. Covers visual direction, the 3D scene rules, and interface copy.

---

## 1. The central metaphor

**Lights coming on in a block at dusk.**

Every completed shift turns another light on. A block where people are showing up for each other is a block that's lit. A quiet week is a block at dusk with a few windows glowing — not a dark ruin, just quiet. Warmth accumulates; nothing burns down.

This metaphor does three jobs at once:

- It makes the visualization *legible at a glance* — you know instantly whether the community is active
- It gives the palette a reason to exist rather than being decoration
- It carries the tone constraint from the PRD: growth pauses, it never punishes

Everything below follows from this. If a design decision doesn't serve the lamplight metaphor, cut it.

## 2. References

| Reference | What we take |
|-----------|-------------|
| **Townscaper** | Simple geometric buildings that read as charming rather than as placeholder assets. Proof that low-poly is a style, not a compromise. |
| **Habitica / Forest** | The core mechanic: real-world action grows a virtual object. Also study how they handle *inaction*. |
| **GitHub contribution graph** | Restraint. Ambient truth-telling that doesn't shout. |
| **Animal Crossing** | Tone. Warm, unhurried, celebrates what happened. |

**Anti-reference: Duolingo streak mechanics.** Loss aversion and streak guilt are wrong for volunteer goodwill. No broken-streak animations, no wilting, no red.

## 3. Visual tokens

### Color

The palette is a dusk scene, not a UI kit. Cool base, warm light.

```css
--dusk:        #2B3B52;  /* sky, primary background */
--dusk-deep:   #1C2838;  /* ground plane, shadow, panel base */
--stone:       #DCD3C4;  /* building faces — warm, catches light */
--stone-dim:   #9AA3AE;  /* empty lots, inactive state */
--lamp:        #FFC94A;  /* window light — THE accent, used sparingly */
--lamp-soft:   #FFE3A3;  /* glow falloff, hover states */
--moss:        #7A9A72;  /* gardens, streak growth */
--brick:       #8C5A4A;  /* roofs, structural accent only */
```

**Discipline rule:** `--lamp` is the only saturated warm in the system and it means exactly one thing — *someone showed up*. Never use it for buttons, links, borders, or decoration. If gold appears somewhere that isn't a completed shift, the metaphor is broken and the scene stops being readable.

Empty lots use `--stone-dim`, not a darker or redder tone. Empty is neutral, never negative.

### Typography

**Display: Fraunces.** Variable serif with a soft/wonk axis. Warm and slightly irregular, which suits a neighborhood tool. Set at low-to-mid optical size with modest weight; avoid tight display settings that read as editorial.

**Body: Public Sans.** Open source, humanist, and it's the typeface of the US Web Design System — civic infrastructure lineage, which is quietly appropriate for a tool serving community orgs. Neutral without being Inter.

Scale (1.25 ratio):

| Role | Size | Family |
|------|------|--------|
| Scene title | 39px | Fraunces 500 |
| Section head | 25px | Fraunces 500 |
| Body | 16px | Public Sans 400 |
| Detail / timestamp | 13px | Public Sans 400 |

Line length under 70 characters. Sentence case everywhere.

**Do not:** use all-caps labels, accent a single word in a headline in a different color or weight, or add typographic eyebrow labels above headings. These are the default tells and they'll make the whole thing read as generated.

### Layout

The Block is the page. The 3D scene is not a widget inside a dashboard — it fills the viewport, and everything else is an overlay on top of it.

```
┌──────────────────────────────────────────────┐
│  The Block                        [Digest ▸] │  ← thin, quiet
│                                              │
│                                              │
│            [ 3D SCENE — full bleed ]         │
│                                              │
│                                              │
│  ┌────────────────────────────┐              │
│  │ Recent activity            │              │  ← low-left overlay,
│  │ Maria covered Sat 9am      │              │    fades after inactivity
│  └────────────────────────────┘              │
└──────────────────────────────────────────────┘
```

Digest panel slides in from the right, semi-transparent over the scene, never a separate page.

Left-aligned throughout. No centered body text.

## 4. The 3D scene

### Geometry rules

**Volunteer plots are primitives.** In react-three-fiber: `<boxGeometry>`,
`<cylinderGeometry>`, `<coneGeometry>`, `<planeGeometry>`. Flat-shaded
(`<meshStandardMaterial roughness={1}>`).

**The world around them is a CC0 low-poly pack** (`public/models/`, 21 assets,
728 KB) — roads, pavements, grass, trees, benches, lamps, cars, a bus shelter,
and the towers on the horizon.

*Revised during the build.* This section originally said "primitives only, no
imported models", and `prd.md` §10 listed that as the mitigation for the risk
*"3D eats all the time"*. The pack removed that risk rather than adding to it:
it is untextured, one mesh and one material per asset, and it arrived finished.

The split is deliberate and load-bearing. **A plot is a volunteer and its stage
is derived from their completed shifts**, so plots stay primitives the code
generates from data. Everything the pack supplies is scenery — it carries no
state and means nothing. That keeps *if the scene shows a building, an event
caused it* literally true.

Two rules govern how the pack is used:

- **Retint, never adopt.** The assets carry colour in `COLOR_0` vertex
  attributes, and the pack's own palette is bright orange and blue. Materials
  keep `vertexColors: true` but multiply a tint from §3 through them, so the
  pack's shading survives and its hue does not. Flattening each asset to one
  colour would turn every tree into a green blob.
- **Nothing borrowed may glow.** Street lamps ship unlit. The skyline carries no
  lit windows at all. `--lamp` means one thing and only earned light may use it.

Buildings are assembled from stacked boxes with slight per-plot random rotation (±3°) and scale jitter so the block doesn't read as a spreadsheet. That jitter is the entire difference between "charming little town" and "bar chart in 3D."

### Growth stages

Driven entirely by derived state from the event log. Each stage is additive geometry — nothing is ever removed.

| Stage | Trigger | Geometry |
|-------|---------|----------|
| 0 — Empty lot | Volunteer joined, no completed shifts | Flat plane, `--stone-dim` |
| 1 — Foundation | 1 completed shift | Low slab |
| 2 — Walls | 2–3 shifts | Box, `--stone` |
| 3 — Roof | 4–6 shifts | Box + `--brick` cone/prism |
| 4 — Lit | 7+ shifts | Windows emit `--lamp`, small point light |
| 5 — Garden | 4-week streak | `--moss` details at base |

**Inaction:** growth pauses. The building stays exactly as it was. Windows dim slightly over weeks of inactivity (from `--lamp` toward `--lamp-soft` at low intensity) but never go fully dark and never regress a stage. A returning volunteer's lights come back up — that's the moment worth animating.

### Camera and motion

Fixed elevation, free rotation, bounded zoom, no free camera. One orchestrated moment only: when a new event lands, that plot's light comes up over ~1.2s with a soft ease. Everything else is static.

*Revised during the build.* Rotation was originally clamped to a 57° arc around
the default corner, and zoom was off. The arc was not a design decision — plots
only carried windows on their +Z and +X faces, so any wider swing showed a
street of blank dark boxes and lost "every light is someone who showed up".
Windows now sit on all four faces, so the block can be walked around.

Elevation stays clamped and panning stays off: you cannot get under the ground
plane, look straight down, or lose the block offscreen. That is what "no free
camera" was protecting, and it still holds. Zoom is bounded rather than absent,
because the figures waiting outside the food bank are the one thing a viewer
should be able to count, and at the default distance they are too small to.

Do not add ambient drifting, floating particles, or per-element hover transitions. One moment of motion that means something beats scattered effects.

### Mobile

Same scene, a wider lens so the block still fills a portrait viewport, and the same orbit and zoom as desktop. Overlays stack vertically. This is why it's a web app — one build, both surfaces.

*Revised during the build.* Orbit was originally disabled on mobile to avoid
fighting page scroll. There is no page scroll: `.shell` is `position: fixed`
with `overflow: hidden`, so the gesture has nothing to conflict with.

## 5. Entry surface

A judge lands on the live URL cold. They see glowing boxes and have no idea what a plot is, why it's lit, or that an agent put it there. That's a real hit to Design and Impact — both are about whether the thing reads as a coherent product.

**This is orientation, not a landing page.** No hero section, no feature grid, no scroll. Devpost's description field and the video already do marketing; this does not.

**Shape:** the app loads directly into a live, populated Block. A one-screen overlay sits on top of it, dismissible. The product is visible behind the overlay from the first frame — never make the judge click through a door to reach the thing you built.

```
┌──────────────────────────────────────────────┐
│                                              │
│      ░░░ live Block visible behind ░░░       │
│                                              │
│      ┌────────────────────────────────┐      │
│      │  The Block                     │      │
│      │                                │      │
│      │  A food bank's volunteer       │      │
│      │  activity, kept by an agent.   │      │
│      │  Every light is someone who    │      │
│      │  showed up.                    │      │
│      │                                │      │
│      │  [ Run the agent ]  [ Look around ] │ │
│      └────────────────────────────────┘      │
└──────────────────────────────────────────────┘
```

After dismissal, a thin persistent header keeps the one-line identity visible. Everything else lives in the digest panel, which is real product rather than explanatory copy.

**"Run the agent"** posts to `/api/trigger/loop` and dismisses the overlay so the judge watches it happen. The endpoint already exists for the demo, so exposing it costs nothing. A judge who can make the agent visibly act in one click scores it higher than one taking the video's word for it.

**No waitlist button, no email capture.** There's no waitlist to join and no launch to wait for. A button leading to a dead end is a seam, and judges who find one seam discount everything else. Nothing in the rubric rewards commercial signalling, and collecting addresses in a prototype with no privacy policy buys nothing.

Copy rules from §6 apply. Three sentences maximum in the overlay. If it needs a fourth, the scene isn't legible enough and that's the thing to fix.

## 6. Coordinator digest

The coordinator surface is deliberately plain. It is not a dashboard to babysit; it's a record of what already happened.

Structure, in order:

1. **What the agent noticed** — reflections, most recent first, each with the raw events it came from expandable underneath
2. **What the agent did** — asks sent, who, why
3. **What's still open** — gaps the agent couldn't fill

That provenance expansion in item 1 is a demo asset, not a nicety. It's how you prove on camera that the insight came from real logged events rather than an LLM confabulating a plausible sentence.

Typography-driven, minimal chrome. No cards, no shadows, no icon set.

## 7. Interface copy

Plain verbs, sentence case, no filler. The interface speaks about volunteers with warmth and about gaps without drama.

| Situation | Write | Don't write |
|-----------|-------|-------------|
| Empty block, new install | "No shifts logged yet. The block fills in as people show up." | "Get started by adding your first volunteer!" |
| Volunteer inactive | "Quiet since Aug 12." | "Streak lost" / "You've fallen behind" |
| Shift short | "Saturday 9am is short two people." | "⚠️ CRITICAL COVERAGE ALERT" |
| Agent sent an ask | "Asked Maria and James — both have covered this slot before." | "Notification dispatched to 2 recipients" |
| Shift covered | "James covered Saturday 9am." | "Great job! +10 points! 🎉" |

Points exist in the data model and drive plot growth, but the interface rarely says a number out loud. The building growing *is* the reward. A visible score turns a neighborhood into a scoreboard.

Errors state what happened and what to do. They don't apologize and they don't use a person's voice.

## 8. Accessibility floor

Non-negotiable, and cheap to hit if built in from the start:

- The 3D scene is decorative-plus; all of its information is also available as text in the digest. Never make lit-vs-unlit the only way to know something.
- `prefers-reduced-motion` disables the light-up animation; the state still changes, just instantly.
- Keyboard focus visible on all overlay controls.
- Text contrast against `--dusk` meets 4.5:1 — check `--stone` on `--dusk` and adjust the stone value up if it fails rather than adding a scrim.
- Don't rely on `--lamp` alone to convey activity in the digest; pair with text.

## 9. What to cut first

If time runs short, cut in this order. The agent is what's judged; the scene is what makes it memorable.

1. Garden / streak details (stage 5)
2. Per-plot geometry jitter
3. Light-up animation (jump to end state)
4. 3D entirely → flat 2D grid of plots with the same growth stages and the same palette

Cutting to a 2D grid is an acceptable outcome. Shipping a broken 3D scene is not.
