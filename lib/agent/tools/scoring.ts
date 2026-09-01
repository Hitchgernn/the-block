import { tool } from '@strands-agents/sdk'
import { z } from 'zod'
import { derivePlots } from '@/lib/db/derive'
import { insertEvent, listVolunteers, queryEvents } from '@/lib/db/queries'
import type { EventType } from '@/lib/types'

/**
 * Log step, architecture.md section 3.1.
 *
 * `awardPoints` writes no points. Points are derived from `shift_completed`
 * events by derive.ts and never stored (architecture.md section 3.2) — a stored
 * total is a column that can drift from the log, and the whole guarantee of the
 * 3D view is that it cannot. So the tool logs the completion and then reports
 * the total derive.ts now computes, which is the honest answer to "how many
 * points did that earn".
 */

// `satisfies` keeps this list from drifting into a type that EventType does not
// have. It cannot catch an omission, so add new event types in both places.
const EVENT_TYPES = [
  'shift_opened',
  'ask_sent',
  'ask_accepted',
  'ask_declined',
  'shift_completed',
  'no_show',
  'shift_short',
  'agent_reasoning',
] as const satisfies readonly EventType[]

const COMPLETION_SCAN_LIMIT = 500

export async function recordEvent(input: {
  type: EventType
  volunteerId?: string | null
  shiftId?: string | null
  payload?: Record<string, unknown>
  importance?: number
}): Promise<number> {
  return insertEvent(input)
}

export interface PointsResult {
  eventId: number
  volunteerId: string
  /** Recomputed from the log, not incremented. */
  points: number
  completedShifts: number
  stage: number
  /** Always false. Kept explicit so nobody adds a points column later. */
  stored: false
}

export async function recordCompletion(input: {
  volunteerId: string
  shiftId: string
  slot: string
}): Promise<PointsResult> {
  const eventId = await insertEvent({
    type: 'shift_completed',
    volunteerId: input.volunteerId,
    shiftId: input.shiftId,
    payload: { slot: input.slot },
    importance: 3,
  })

  const [volunteers, completions] = await Promise.all([
    listVolunteers(),
    queryEvents({
      volunteerId: input.volunteerId,
      types: ['shift_completed'],
      limit: COMPLETION_SCAN_LIMIT,
    }),
  ])

  const volunteer = volunteers.find((v) => v.id === input.volunteerId)
  const plot = volunteer ? derivePlots([volunteer], completions)[0] : undefined

  return {
    eventId,
    volunteerId: input.volunteerId,
    points: plot?.points ?? 0,
    completedShifts: plot?.completedShifts ?? 0,
    stage: plot?.stage ?? 0,
    stored: false,
  }
}

export const logEvent = tool({
  name: 'log_event',
  description:
    'Append one event to the append-only log. Use this to record anything that happened, including your own reasoning about a shift.',
  inputSchema: z.object({
    type: z.enum(EVENT_TYPES).describe('The kind of thing that happened.'),
    volunteerId: z
      .string()
      .nullable()
      .optional()
      .describe('The volunteer it concerns, if any.'),
    shiftId: z
      .string()
      .nullable()
      .optional()
      .describe('The shift it concerns, if any.'),
    payload: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Detail for this event. Always include `slot` when there is one.'),
    importance: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe('1 routine to 5 significant. Used by retrieval. Defaults to 3.'),
  }),
  callback: (input) => recordEvent(input),
})

export const awardPoints = tool({
  name: 'award_points',
  description:
    'Record that a volunteer completed a shift, which is what earns them points and grows their plot. Points are derived from this event, never stored, so this is the only way to award them.',
  inputSchema: z.object({
    volunteerId: z.string().describe('Volunteer id, for example "v-maria".'),
    shiftId: z.string().describe('The shift they covered, for example "sat9-2026-09-05".'),
    slot: z.string().describe('The slot label, for example "Saturday 9am".'),
  }),
  callback: (input) => recordCompletion(input),
})
