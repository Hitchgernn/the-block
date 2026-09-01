import { db } from './db/client'
import type { EventType } from '@/lib/types'

/**
 * Seeded demo scenario. See architecture.md section 6.
 *
 * Realistic and narratively deliberate: eight weeks of history for twenty
 * volunteers with ONE planted pattern the agent can genuinely discover —
 * Saturday 9am quietly degrading over six weeks as two reliable regulars drift
 * off. Every other slot stays healthy, so surfacing the right slot is a real
 * finding rather than the only thing available to say.
 *
 * Fully deterministic: the demo must be reproducible, and a reflection prompt
 * tuned against shifting data is untunable.
 *
 * This is seeded INPUT. The agent logic operating on it is real. Say so in the
 * README and in the video (prd.md section 10).
 */

// --- deterministic RNG -----------------------------------------------------

function makeRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

// --- cast ------------------------------------------------------------------

interface SeedVolunteer {
  id: string
  name: string
  slackHandle: string
  preferredSlots: string[]
  /** Rough attendance likelihood for their preferred slots. */
  reliability: number
}

const SAT_AM = 'Saturday 9am'
const SAT_PM = 'Saturday 1pm'
const TUE_PM = 'Tuesday 5pm'
const THU_PM = 'Thursday 5pm'

/** The two regulars whose drift causes the whole pattern. */
const DRIFTERS = ['v-maria', 'v-james']

const VOLUNTEERS: SeedVolunteer[] = [
  { id: 'v-maria',    name: 'Maria Ocampo',      slackHandle: '@maria',    preferredSlots: [SAT_AM],         reliability: 0.95 },
  { id: 'v-james',    name: 'James Whitfield',   slackHandle: '@james',    preferredSlots: [SAT_AM],         reliability: 0.92 },
  { id: 'v-aisha',    name: 'Aisha Rahman',      slackHandle: '@aisha',    preferredSlots: [SAT_AM, SAT_PM], reliability: 0.88 },
  { id: 'v-tomas',    name: 'Tomás Delgado',     slackHandle: '@tomas',    preferredSlots: [SAT_AM],         reliability: 0.8  },
  { id: 'v-grace',    name: 'Grace Lin',         slackHandle: '@grace',    preferredSlots: [SAT_AM, TUE_PM], reliability: 0.85 },
  { id: 'v-devon',    name: 'Devon Clarke',      slackHandle: '@devon',    preferredSlots: [SAT_AM],         reliability: 0.7  },
  { id: 'v-priya',    name: 'Priya Nair',        slackHandle: '@priya',    preferredSlots: [SAT_PM],         reliability: 0.9  },
  { id: 'v-oscar',    name: 'Oscar Mbeki',       slackHandle: '@oscar',    preferredSlots: [SAT_PM],         reliability: 0.85 },
  { id: 'v-hannah',   name: 'Hannah Berg',       slackHandle: '@hannah',   preferredSlots: [SAT_PM],         reliability: 0.8  },
  { id: 'v-lucas',    name: 'Lucas Moreau',      slackHandle: '@lucas',    preferredSlots: [SAT_PM, THU_PM], reliability: 0.75 },
  { id: 'v-nina',     name: 'Nina Petrov',       slackHandle: '@nina',     preferredSlots: [TUE_PM],         reliability: 0.9  },
  { id: 'v-samuel',   name: 'Samuel Achebe',     slackHandle: '@samuel',   preferredSlots: [TUE_PM],         reliability: 0.88 },
  { id: 'v-yuki',     name: 'Yuki Tanaka',       slackHandle: '@yuki',     preferredSlots: [TUE_PM],         reliability: 0.8  },
  { id: 'v-rosa',     name: 'Rosa Iglesias',     slackHandle: '@rosa',     preferredSlots: [TUE_PM, THU_PM], reliability: 0.7  },
  { id: 'v-caleb',    name: 'Caleb Turner',      slackHandle: '@caleb',    preferredSlots: [THU_PM],         reliability: 0.9  },
  { id: 'v-fatima',   name: 'Fatima Haddad',     slackHandle: '@fatima',   preferredSlots: [THU_PM],         reliability: 0.85 },
  { id: 'v-ben',      name: 'Ben Okafor',        slackHandle: '@ben',      preferredSlots: [THU_PM],         reliability: 0.8  },
  { id: 'v-elena',    name: 'Elena Vasquez',     slackHandle: '@elena',    preferredSlots: [THU_PM, SAT_AM], reliability: 0.75 },
  { id: 'v-marcus',   name: 'Marcus Bell',       slackHandle: '@marcus',   preferredSlots: [SAT_AM],         reliability: 0.65 },
  { id: 'v-ingrid',   name: 'Ingrid Solberg',    slackHandle: '@ingrid',   preferredSlots: [SAT_PM],         reliability: 0.65 },
  { id: 'v-noor',     name: 'Noor Al-Amin',      slackHandle: '@noor',     preferredSlots: [SAT_AM],         reliability: 0.82 },
  { id: 'v-wen',      name: 'Wen Zhao',          slackHandle: '@wen',      preferredSlots: [TUE_PM],         reliability: 0.85 },
  { id: 'v-theo',     name: 'Theo Andersson',    slackHandle: '@theo',     preferredSlots: [SAT_AM],         reliability: 0.78 },
]

interface SlotSpec {
  label: string
  minimum: number
  /** 0 = Sunday. */
  weekday: number
  hour: number
}

const SLOTS: SlotSpec[] = [
  { label: SAT_AM, minimum: 6, weekday: 6, hour: 9 },
  { label: SAT_PM, minimum: 4, weekday: 6, hour: 13 },
  { label: TUE_PM, minimum: 4, weekday: 2, hour: 17 },
  { label: THU_PM, minimum: 4, weekday: 4, hour: 17 },
]

const SLOT_IDS: Record<string, string> = {
  [SAT_AM]: 'sat9',
  [SAT_PM]: 'sat13',
  [TUE_PM]: 'tue17',
  [THU_PM]: 'thu17',
}

const WEEKS_OF_HISTORY = 8

// --- helpers ---------------------------------------------------------------

function startOfWeek(date: Date): Date {
  const copy = new Date(date)
  copy.setUTCHours(0, 0, 0, 0)
  copy.setUTCDate(copy.getUTCDate() - copy.getUTCDay())
  return copy
}

function shiftDate(weekStart: Date, slot: SlotSpec): Date {
  const date = new Date(weekStart)
  date.setUTCDate(date.getUTCDate() + slot.weekday)
  date.setUTCHours(slot.hour, 0, 0, 0)
  return date
}

interface PendingEvent {
  ts: string
  type: EventType
  volunteerId: string | null
  shiftId: string | null
  payload: Record<string, unknown>
  importance: number
}

/**
 * The planted decay. Weeks 0-1 Saturday 9am is fully covered; from week 2 the
 * two regulars stop turning up and coverage slides. By the recent weeks it is
 * reliably short. Nothing else in the dataset degrades.
 */
function attends(
  volunteer: SeedVolunteer,
  slot: SlotSpec,
  weekIndex: number,
  random: () => number,
): boolean {
  if (!volunteer.preferredSlots.includes(slot.label)) {
    // Rare cover outside a preferred slot, so the data doesn't look generated.
    // Kept low: at 20+ volunteers even a small rate inflates every headcount.
    return random() < 0.02
  }

  if (slot.label === SAT_AM) {
    if (DRIFTERS.includes(volunteer.id)) {
      // Present for the first three weeks, then quietly gone. This is the signal.
      return weekIndex < 3 && random() < volunteer.reliability
    }
    // As the slot gets thinner the remaining regulars turn out slightly less
    // too — a short shift is a worse shift to work. This is what turns two
    // people leaving into a six-week slide rather than a one-week dip.
    const fatigue = 1 - 0.035 * weekIndex
    return random() < volunteer.reliability * fatigue
  }

  return random() < volunteer.reliability
}

// --- seed ------------------------------------------------------------------

export interface SeedResult {
  volunteers: number
  events: number
  weeks: number
  plantedSlot: string
}

export async function seed(now: Date = new Date()): Promise<SeedResult> {
  const client = db()
  const random = makeRandom(20260901)

  await client.batch(
    [
      'DELETE FROM events',
      'DELETE FROM reflections',
      'DELETE FROM volunteers',
      "DELETE FROM sqlite_sequence WHERE name IN ('events','reflections')",
    ],
    'write',
  )

  const joinedAt = new Date(now)
  joinedAt.setUTCFullYear(joinedAt.getUTCFullYear() - 1)

  await client.batch(
    VOLUNTEERS.map((volunteer) => ({
      sql: `INSERT INTO volunteers (id, name, slack_handle, joined_at, preferred_slots)
            VALUES (?, ?, ?, ?, ?)`,
      args: [
        volunteer.id,
        volunteer.name,
        volunteer.slackHandle,
        joinedAt.toISOString(),
        JSON.stringify(volunteer.preferredSlots),
      ],
    })),
    'write',
  )

  const events: PendingEvent[] = []
  const thisWeek = startOfWeek(now)

  // --- history: oldest week first so ids read chronologically ---------------
  for (let weekOffset = WEEKS_OF_HISTORY; weekOffset >= 1; weekOffset -= 1) {
    const weekStart = new Date(thisWeek)
    weekStart.setUTCDate(weekStart.getUTCDate() - weekOffset * 7)
    const weekIndex = WEEKS_OF_HISTORY - weekOffset // 0 = oldest

    for (const slot of SLOTS) {
      const when = shiftDate(weekStart, slot)
      if (when.getTime() > now.getTime()) continue

      const shiftId = `${SLOT_IDS[slot.label]}-${when.toISOString().slice(0, 10)}`
      const opened = new Date(when)
      opened.setUTCDate(opened.getUTCDate() - 10)

      events.push({
        ts: opened.toISOString(),
        type: 'shift_opened',
        volunteerId: null,
        shiftId,
        payload: {
          slot: slot.label,
          startsAt: when.toISOString(),
          minimum: slot.minimum,
        },
        importance: 2,
      })

      const attendees = VOLUNTEERS.filter((volunteer) =>
        attends(volunteer, slot, weekIndex, random),
      )

      // Every slot except the planted one gets filled: a coordinator who
      // notices a gap makes calls and covers it. Saturday 9am is the one
      // nobody is watching, which is the entire premise (prd.md section 2).
      // Without this the other slots dip too and "Saturday 9am is short" stops
      // being a real finding.
      if (slot.label !== SAT_AM && attendees.length < slot.minimum + 1) {
        const bench = VOLUNTEERS.filter(
          (volunteer) =>
            volunteer.preferredSlots.includes(slot.label) &&
            !attendees.includes(volunteer),
        ).sort((a, b) => b.reliability - a.reliability)

        // Top up to minimum + 1, not minimum: a single no-show would otherwise
        // drop a covered slot under the line and blur the planted pattern.
        const target = slot.minimum + 1
        attendees.push(...bench.slice(0, target - attendees.length))
      }

      for (const volunteer of attendees) {
        const accepted = new Date(when)
        accepted.setUTCDate(accepted.getUTCDate() - 3)

        events.push({
          ts: accepted.toISOString(),
          type: 'ask_accepted',
          volunteerId: volunteer.id,
          shiftId,
          payload: { slot: slot.label },
          importance: 2,
        })

        // A small share of acceptances end as no-shows. Distinguishing signed
        // up from showed up is the point of the event log (prd.md F2).
        if (random() < 0.07) {
          events.push({
            ts: when.toISOString(),
            type: 'no_show',
            volunteerId: volunteer.id,
            shiftId,
            payload: { slot: slot.label },
            importance: 4,
          })
        } else {
          const done = new Date(when)
          done.setUTCHours(done.getUTCHours() + 3)
          events.push({
            ts: done.toISOString(),
            type: 'shift_completed',
            volunteerId: volunteer.id,
            shiftId,
            payload: { slot: slot.label },
            importance: 3,
          })
        }
      }

      const showed = events.filter(
        (event) => event.shiftId === shiftId && event.type === 'shift_completed',
      ).length

      if (showed < slot.minimum) {
        const logged = new Date(when)
        logged.setUTCHours(logged.getUTCHours() + 4)
        events.push({
          ts: logged.toISOString(),
          type: 'shift_short',
          volunteerId: null,
          shiftId,
          payload: {
            slot: slot.label,
            minimum: slot.minimum,
            showed,
            short: slot.minimum - showed,
          },
          importance: 5,
        })
      }
    }
  }

  // --- upcoming: open shifts for the agent to actually act on ---------------
  for (let weekOffset = 0; weekOffset <= 1; weekOffset += 1) {
    const weekStart = new Date(thisWeek)
    weekStart.setUTCDate(weekStart.getUTCDate() + weekOffset * 7)

    for (const slot of SLOTS) {
      const when = shiftDate(weekStart, slot)
      if (when.getTime() <= now.getTime()) continue

      const shiftId = `${SLOT_IDS[slot.label]}-${when.toISOString().slice(0, 10)}`

      events.push({
        ts: now.toISOString(),
        type: 'shift_opened',
        volunteerId: null,
        shiftId,
        payload: {
          slot: slot.label,
          startsAt: when.toISOString(),
          minimum: slot.minimum,
        },
        importance: 2,
      })

      // Saturday 9am is left visibly short. Everything else is nearly full, so
      // the agent has to choose rather than being handed the only option.
      const target =
        slot.label === SAT_AM ? slot.minimum - 3 : slot.minimum - 1

      const candidates = VOLUNTEERS.filter(
        (volunteer) =>
          volunteer.preferredSlots.includes(slot.label) &&
          !(slot.label === SAT_AM && DRIFTERS.includes(volunteer.id)),
      )

      for (const volunteer of candidates.slice(0, Math.max(0, target))) {
        const accepted = new Date(now)
        accepted.setUTCHours(accepted.getUTCHours() - 20)
        events.push({
          ts: accepted.toISOString(),
          type: 'ask_accepted',
          volunteerId: volunteer.id,
          shiftId,
          payload: { slot: slot.label },
          importance: 2,
        })
      }
    }
  }

  events.sort((a, b) => a.ts.localeCompare(b.ts))

  await client.batch(
    events.map((event) => ({
      sql: `INSERT INTO events (ts, type, volunteer_id, shift_id, payload, importance)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        event.ts,
        event.type,
        event.volunteerId,
        event.shiftId,
        JSON.stringify(event.payload),
        event.importance,
      ],
    })),
    'write',
  )

  return {
    volunteers: VOLUNTEERS.length,
    events: events.length,
    weeks: WEEKS_OF_HISTORY,
    plantedSlot: SAT_AM,
  }
}
