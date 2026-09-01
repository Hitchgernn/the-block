import { Agent, BedrockModel } from '@strands-agents/sdk'
import { z } from 'zod'
import {
  getEventsByIds,
  insertReflection,
  listReflections,
  listVolunteers,
  queryEvents,
  recentEvents,
} from '@/lib/db/queries'
import { deriveShifts } from '@/lib/db/derive'
import type {
  EventRecord,
  Reflection,
  SlotLabel,
  TriggerResponse,
  Volunteer,
} from '@/lib/types'

/**
 * The reflection job. architecture.md section 3.4, prd.md F3.
 *
 * Raw events in, genuinely non-obvious insight out, source events traceable.
 * This is the differentiator against every scheduling tool that already exists
 * (prd.md section 2): scheduling is solved, nobody is watching the pattern.
 *
 * Shape of the pass:
 *
 *   1. Two bounded reads of the event log
 *   2. Pre-aggregate into a per-slot-per-week table  <- pure, testable, no model
 *   3. ONE model call with Zod structured output
 *   4. Validate the cited event ids actually exist, then write to `reflections`
 *
 * Step 2 is not an optimisation, it is the design. architecture.md section 3.4
 * names serverless timeout as the main gotcha of this stack, and pasting four
 * hundred raw event rows into a prompt is both the slowest and the *worst* way
 * to ask "has this slot been degrading" — the model would have to re-derive a
 * count we can compute exactly. We do the counting; the model does the reading.
 *
 * The prompt lives here rather than in lib/agent/prompts.ts on purpose: it is
 * meaningless without the exact brief format `renderBrief` emits below, and
 * splitting the two invites them to drift apart.
 */

// --- bounds ----------------------------------------------------------------

/**
 * Coverage history read. Filtered to the four event types that describe who
 * turned up, which is roughly half the log — `ask_accepted` is the bulk of it
 * and says nothing about attendance. 400 rows is about twelve weeks of this
 * data; older weeks fall off the back rather than growing the read forever.
 */
const COVERAGE_EVENT_LIMIT = 400

/** Recent-activity read, used for upcoming coverage. Newest first. */
const RECENT_EVENT_LIMIT = 150

/** Ids printed per brief row. A shift has ~10 people; this is a safety valve. */
const MAX_IDS_PER_ROW = 12

/** Provenance list length per reflection. The digest renders these in full. */
const MAX_SOURCE_IDS = 12

/** Fewer, sharper reflections beat a padded list. */
const MAX_REFLECTIONS = 4

/** A regular is "lapsed" once they have skipped this many of their slot's runs. */
const LAPSED_MISSED_THRESHOLD = 3

/** Below this they were never a regular, they were a visitor. */
const LAPSED_MIN_COMPLETED = 2

// --- aggregation types -----------------------------------------------------

/** One dated run of a slot that has already happened. */
export interface SlotWeek {
  shiftId: string
  /** YYYY-MM-DD of the shift start. */
  date: string
  minimum: number
  showed: number
  noShows: number
  /** minimum - showed, floored at 0. */
  short: number
  eventIds: number[]
}

export interface SlotHistory {
  slot: SlotLabel
  minimum: number
  /** Oldest first — the model is being asked to read a trend. */
  weeks: SlotWeek[]
  shortWeeks: number
}

/** Someone who used to cover a slot regularly and has stopped. */
export interface LapsedRegular {
  volunteerId: string
  name: string
  slot: SlotLabel
  completed: number
  firstSeen: string
  lastSeen: string
  /** Runs of that slot since their last appearance. */
  missedSince: number
  eventIds: number[]
}

/** A shift that has not run yet, with its current commitment count. */
export interface UpcomingGap {
  slot: SlotLabel
  shiftId: string
  date: string
  minimum: number
  committed: number
  short: number
  eventIds: number[]
}

/**
 * Everything the model is given, in structured form. Deliberately separable
 * from the model call so it can be inspected — and judged — without spending a
 * token. If the signal does not survive this step, no prompt will recover it.
 */
export interface ReflectionBrief {
  generatedAt: string
  slots: SlotHistory[]
  lapsed: LapsedRegular[]
  upcoming: UpcomingGap[]
  priorReflections: string[]
  newEventsSinceLastReflection: number
  eventsConsidered: number
  /**
   * Every event id quoted in the rendered brief. The model may only cite from
   * this set — it is the whitelist the returned ids are filtered against.
   */
  offeredEventIds: number[]
}

// --- aggregation (pure) ----------------------------------------------------

function dayOf(iso: string): string {
  return iso.slice(0, 10)
}

function dedupeById(events: EventRecord[]): EventRecord[] {
  const byId = new Map<number, EventRecord>()
  for (const event of events) byId.set(event.id, event)
  return [...byId.values()]
}

function slotOf(event: EventRecord): string | null {
  const slot = event.payload.slot
  return typeof slot === 'string' ? slot : null
}

/**
 * events -> the table the model actually reads. Pure: no I/O, no clock beyond
 * the `now` passed in, so it is reproducible against the deterministic seed.
 */
export function aggregate(input: {
  coverageEvents: EventRecord[]
  recentEvents: EventRecord[]
  volunteers: Volunteer[]
  priorReflections: Reflection[]
  now: Date
}): ReflectionBrief {
  const { volunteers, priorReflections, now } = input
  const all = dedupeById([...input.coverageEvents, ...input.recentEvents]).sort(
    (a, b) => a.ts.localeCompare(b.ts) || a.id - b.id,
  )

  // --- shifts, from shift_opened ------------------------------------------
  interface ShiftBucket {
    shiftId: string
    slot: SlotLabel
    startsAt: string
    minimum: number
    showed: number
    noShows: number
    eventIds: number[]
  }

  const shifts = new Map<string, ShiftBucket>()

  for (const event of all) {
    if (event.type !== 'shift_opened' || !event.shiftId) continue
    shifts.set(event.shiftId, {
      shiftId: event.shiftId,
      slot: slotOf(event) ?? 'Unknown slot',
      startsAt: String(event.payload.startsAt ?? event.ts),
      minimum: Number(event.payload.minimum ?? 0),
      showed: 0,
      noShows: 0,
      eventIds: [event.id],
    })
  }

  for (const event of all) {
    if (!event.shiftId) continue
    const shift = shifts.get(event.shiftId)
    if (!shift) continue

    if (event.type === 'shift_completed') {
      shift.showed += 1
      shift.eventIds.push(event.id)
    } else if (event.type === 'no_show') {
      shift.noShows += 1
      shift.eventIds.push(event.id)
    } else if (event.type === 'shift_short') {
      // Highest-importance row in the log and the one that names the gap in
      // words. Put it first so it survives the per-row id cap.
      shift.eventIds.unshift(event.id)
    }
  }

  // --- history, grouped by slot -------------------------------------------
  const past = [...shifts.values()]
    .filter((shift) => Date.parse(shift.startsAt) < now.getTime())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))

  const bySlot = new Map<SlotLabel, SlotHistory>()

  for (const shift of past) {
    const week: SlotWeek = {
      shiftId: shift.shiftId,
      date: dayOf(shift.startsAt),
      minimum: shift.minimum,
      showed: shift.showed,
      noShows: shift.noShows,
      short: Math.max(0, shift.minimum - shift.showed),
      eventIds: shift.eventIds.slice(0, MAX_IDS_PER_ROW),
    }

    const history = bySlot.get(shift.slot) ?? {
      slot: shift.slot,
      minimum: shift.minimum,
      weeks: [],
      shortWeeks: 0,
    }
    history.minimum = shift.minimum
    history.weeks.push(week)
    if (week.short > 0) history.shortWeeks += 1
    bySlot.set(shift.slot, history)
  }

  const slots = [...bySlot.values()].sort((a, b) => a.slot.localeCompare(b.slot))

  // --- lapsed regulars ----------------------------------------------------
  //
  // The seeded pattern (sdk-notes.md section 8) is two reliable regulars
  // leaving in the same week a slot starts sliding. That link is only visible
  // if attendance-per-person and coverage-per-week are in the same brief.
  const nameOf = new Map(volunteers.map((v) => [v.id, v.name]))
  const attendance = new Map<string, LapsedRegular>()

  for (const event of all) {
    if (event.type !== 'shift_completed' || !event.volunteerId) continue
    const slot = slotOf(event)
    if (!slot) continue

    const key = `${event.volunteerId}|${slot}`
    const entry = attendance.get(key) ?? {
      volunteerId: event.volunteerId,
      name: nameOf.get(event.volunteerId) ?? event.volunteerId,
      slot,
      completed: 0,
      firstSeen: dayOf(event.ts),
      lastSeen: dayOf(event.ts),
      missedSince: 0,
      eventIds: [],
    }
    entry.completed += 1
    entry.lastSeen = dayOf(event.ts)
    entry.eventIds.push(event.id)
    attendance.set(key, entry)
  }

  const lapsed: LapsedRegular[] = []

  for (const entry of attendance.values()) {
    const history = bySlot.get(entry.slot)
    if (!history) continue
    entry.missedSince = history.weeks.filter((w) => w.date > entry.lastSeen).length
    if (
      entry.completed >= LAPSED_MIN_COMPLETED &&
      entry.missedSince >= LAPSED_MISSED_THRESHOLD
    ) {
      // Newest ids first: their last appearances are what dates the departure.
      entry.eventIds = entry.eventIds.slice(-MAX_IDS_PER_ROW).reverse()
      lapsed.push(entry)
    }
  }

  lapsed.sort(
    (a, b) => b.missedSince - a.missedSince || b.completed - a.completed,
  )

  // --- upcoming gaps ------------------------------------------------------
  // Reuse deriveShifts so "committed" means exactly what the 3D view and the
  // digest mean by it (architecture.md principle 1, one source of truth).
  const upcoming: UpcomingGap[] = deriveShifts(all, now).map((shift) => ({
    slot: shift.slot,
    shiftId: shift.id,
    date: dayOf(shift.startsAt),
    minimum: shift.minimum,
    committed: shift.committed,
    short: shift.short,
    eventIds: all
      .filter((event) => event.shiftId === shift.id)
      .map((event) => event.id)
      .slice(0, MAX_IDS_PER_ROW),
  }))

  // --- provenance whitelist ------------------------------------------------
  const offered = new Set<number>()
  for (const slot of slots) {
    for (const week of slot.weeks) for (const id of week.eventIds) offered.add(id)
  }
  for (const person of lapsed) for (const id of person.eventIds) offered.add(id)
  for (const gap of upcoming) for (const id of gap.eventIds) offered.add(id)

  const lastReflectionTs = priorReflections[0]?.ts ?? null
  const newSince = lastReflectionTs
    ? all.filter((event) => event.ts > lastReflectionTs).length
    : all.length

  return {
    generatedAt: now.toISOString(),
    slots,
    lapsed,
    upcoming,
    priorReflections: priorReflections.map((r) => r.text),
    newEventsSinceLastReflection: newSince,
    eventsConsidered: all.length,
    offeredEventIds: [...offered],
  }
}

// --- rendering (pure) ------------------------------------------------------

function pad(value: string | number, width: number): string {
  return String(value).padEnd(width)
}

/**
 * The brief, as the model receives it. Compact on purpose: about forty lines
 * standing in for ~370 event rows. Event ids are printed per row because the
 * model must cite real provenance and cannot be trusted to guess ids.
 */
export function renderBrief(brief: ReflectionBrief): string {
  const lines: string[] = []

  lines.push(`Today is ${dayOf(brief.generatedAt)}.`)
  lines.push(
    `${brief.eventsConsidered} events considered, ${brief.newEventsSinceLastReflection} of them since the last reflection.`,
  )
  lines.push('')

  lines.push('COVERAGE — one row per run of a slot, oldest first.')
  lines.push('"short" is how many under the slot minimum actually showed up.')
  for (const slot of brief.slots) {
    lines.push('')
    lines.push(
      `${slot.slot} — minimum ${slot.minimum}, ${slot.shortWeeks} of ${slot.weeks.length} runs short`,
    )
    lines.push('  date        showed  no-shows  short  event_ids')
    for (const week of slot.weeks) {
      lines.push(
        `  ${pad(week.date, 12)}${pad(week.showed, 8)}${pad(week.noShows, 10)}${pad(week.short, 7)}${week.eventIds.join(',')}`,
      )
    }
  }
  lines.push('')

  lines.push('REGULARS WHO HAVE STOPPED — people with a history in a slot who')
  lines.push('have missed its last few runs.')
  if (brief.lapsed.length === 0) {
    lines.push('  (none)')
  } else {
    for (const person of brief.lapsed) {
      lines.push(
        `  ${person.name} — ${person.slot}, ${person.completed} shifts between ${person.firstSeen} and ${person.lastSeen}, missed the ${person.missedSince} runs since. event_ids ${person.eventIds.join(',')}`,
      )
    }
  }
  lines.push('')

  lines.push('COMING UP — shifts that have not run yet.')
  if (brief.upcoming.length === 0) {
    lines.push('  (none)')
  } else {
    for (const gap of brief.upcoming) {
      lines.push(
        `  ${gap.date} ${gap.slot} — minimum ${gap.minimum}, committed ${gap.committed}, short ${gap.short}. event_ids ${gap.eventIds.join(',')}`,
      )
    }
  }

  if (brief.priorReflections.length > 0) {
    lines.push('')
    lines.push('ALREADY RECORDED — do not write a near-duplicate of these.')
    lines.push('If one of them still holds, say what has changed since instead.')
    for (const text of brief.priorReflections) lines.push(`  - ${text}`)
  }

  lines.push('')
  lines.push('Write the reflections now.')

  return lines.join('\n')
}

// --- the model call --------------------------------------------------------

/**
 * Copy rules are design.md section 7, restated for the model because the
 * reflection text is rendered verbatim in the coordinator digest. The failure
 * mode being prevented is an LLM writing "🚨 CRITICAL: Saturday AM coverage
 * collapsing!" onto a surface whose whole tone is undramatic.
 */
const REFLECTION_SYSTEM_PROMPT = `You are the reflection pass of an agent that watches volunteer coverage at a small food bank.

You are given a pre-aggregated summary of what has already happened: attendance per slot per week, regulars who have stopped turning up, and the shifts coming up. Write down what the coordinator would want to know and has no time to work out for themselves.

A good reflection:
- Is about a trend across weeks, a change in a named person's behaviour, or a gap that is about to bite. Never a restatement of one row.
- Names the slot, the direction and the span. "Saturday 9am has run short in five of the last six weeks."
- Connects things when the summary supports it — a slot that started sliding the same week two of its regulars last appeared is one insight, not two.
- Cites the event ids that prove it, taken from the event_ids printed in the summary.

A bad reflection:
- Repeats a single row back. "Saturday 9am had 3 people on 2026-08-29" is data, not an insight.
- Makes a claim the summary does not support.
- Manufactures concern about a slot that has held at or above its minimum. Say nothing rather than pad the list.
- Invents an event id. Only cite ids that appear in the summary.

Return at most ${MAX_REFLECTIONS} reflections, most useful first. Fewer is better than padded.

kind:
  pattern - a trend across several weeks
  person  - a change in one or two named volunteers' behaviour
  risk    - something coming up that will be short

How to write:
- One or two sentences. Plain verbs, sentence case.
- No emoji, no exclamation marks, no all-caps words, no "critical", no "urgent", no "alert".
- Warm about people, undramatic about gaps. Write "Maria Ocampo and James Whitfield last covered Saturday 9am on Jul 18." not "Maria and James have abandoned the shift!"
- Never blame a volunteer for missing shifts. Life happens; state what happened and stop.
- Write dates the way a person says them: "Aug 12", not "2026-08-12".`

const ReflectionItemSchema = z.object({
  kind: z
    .enum(['pattern', 'person', 'risk'])
    .describe('pattern = multi-week trend, person = a named volunteer changed, risk = an upcoming shortfall'),
  text: z
    .string()
    .describe('One or two sentences, sentence case, no emoji, no alarm words'),
  source_event_ids: z
    .array(z.number())
    .describe('Event ids from the summary that prove this. Never invent one.'),
})

/**
 * Wrapped in an object rather than returned as a bare array: structured output
 * is delivered through a tool schema, and a top-level array is the shape most
 * likely to come back subtly wrong.
 */
const ReflectionBatchSchema = z.object({
  reflections: z.array(ReflectionItemSchema),
})

// --- job -------------------------------------------------------------------

/**
 * Both bounded reads plus the aggregation. Exported separately so the brief can
 * be inspected without a model call — see the note on ReflectionBrief.
 */
export async function buildBrief(now: Date = new Date()): Promise<ReflectionBrief> {
  const [coverage, recent, volunteers, priorReflections] = await Promise.all([
    queryEvents({
      types: ['shift_opened', 'shift_completed', 'no_show', 'shift_short'],
      limit: COVERAGE_EVENT_LIMIT,
    }),
    recentEvents(RECENT_EVENT_LIMIT),
    listVolunteers(),
    listReflections(5),
  ])

  return aggregate({
    coverageEvents: coverage,
    recentEvents: recent,
    volunteers,
    priorReflections,
    now,
  })
}

/**
 * Last-resort provenance. If the model cited nothing usable, attach the events
 * that actually underpin the slot it wrote about, chosen by us rather than by
 * it. Honest — these events do support the claim — and it keeps the digest's
 * "here are the raw rows underneath" beat alive, which is the whole reason
 * source_event_ids exists (architecture.md section 3.4).
 */
function fallbackSourceIds(brief: ReflectionBrief, text: string): number[] {
  const named = brief.slots.find((slot) => text.includes(slot.slot))
  const worst = [...brief.slots].sort((a, b) => b.shortWeeks - a.shortWeeks)[0]
  const slot = named ?? worst
  if (!slot) return brief.offeredEventIds.slice(0, MAX_SOURCE_IDS)

  return [...slot.weeks]
    .reverse()
    .flatMap((week) => week.eventIds)
    .slice(0, MAX_SOURCE_IDS)
}

export interface RunReflectionOptions {
  now?: Date
}

/**
 * The whole pass. Returns a TriggerResponse either way — architecture.md
 * principle 4, degrade rather than break: a demo that skips a step beats one
 * that throws on camera.
 */
export async function runReflection(
  options: RunReflectionOptions = {},
): Promise<TriggerResponse> {
  const started = Date.now()
  const now = options.now ?? new Date()

  try {
    const brief = await buildBrief(now)

    const agent = new Agent({
      model: new BedrockModel({
        region: process.env.AWS_REGION,
        modelId: process.env.BEDROCK_MODEL_ID,
        maxTokens: 1500,
        // Low: this is a reading-comprehension task over a table of counts,
        // and the same seeded data should reflect the same way every run.
        temperature: 0.2,
      }),
      systemPrompt: REFLECTION_SYSTEM_PROMPT,
      structuredOutputSchema: ReflectionBatchSchema,
      // sdk-notes.md section 1: `printer` defaults to true and would write the
      // entire reasoning stream into the serverless function log.
      printer: false,
    })

    const result = await agent.invoke(renderBrief(brief))

    // Re-parse rather than trust the SDK's `unknown`-typed structuredOutput.
    const parsed = ReflectionBatchSchema.parse(result.structuredOutput)
    const items = parsed.reflections.slice(0, MAX_REFLECTIONS)

    // Provenance validation, in two passes. First against the whitelist of ids
    // we actually printed, then against the database — an id that does not
    // resolve makes getEventsByIds return nothing and kills the digest beat.
    const offered = new Set(brief.offeredEventIds)
    const candidates = new Set<number>()
    for (const item of items) {
      for (const id of item.source_event_ids) {
        if (offered.has(id)) candidates.add(id)
      }
    }
    const existing = new Set(
      (await getEventsByIds([...candidates])).map((event) => event.id),
    )

    const written: number[] = []
    let backfilled = 0

    for (const item of items) {
      const cited = [...new Set(item.source_event_ids)]
        .filter((id) => existing.has(id))
        .slice(0, MAX_SOURCE_IDS)

      const sourceEventIds =
        cited.length > 0 ? cited : fallbackSourceIds(brief, item.text)
      if (cited.length === 0) backfilled += 1

      written.push(
        await insertReflection({
          ts: now.toISOString(),
          kind: item.kind,
          text: item.text,
          sourceEventIds,
        }),
      )
    }

    const headline = items[0]?.text ?? 'Nothing worth recording this pass.'
    const note = backfilled > 0 ? ` ${backfilled} needed source events filled in.` : ''

    return {
      ok: true,
      elapsedMs: Date.now() - started,
      // Reflections are not events. Leaving this empty is deliberate: the field
      // exists so the UI can highlight newly written *events*, and pointing it
      // at the source events would highlight rows that are weeks old.
      writtenEventIds: [],
      summary: `Wrote ${written.length} reflections from ${brief.eventsConsidered} events. ${headline}${note}`,
    }
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - started,
      writtenEventIds: [],
      summary: 'The reflection pass did not finish.',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
