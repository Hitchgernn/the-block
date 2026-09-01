import { tool } from '@strands-agents/sdk'
import { z } from 'zod'
import { deriveShifts } from '@/lib/db/derive'
import { listEvents } from '@/lib/db/queries'
import type { Shift } from '@/lib/types'

/**
 * Observe step, architecture.md section 3.1.
 *
 * Coverage is derived from the event log by derive.ts rather than read from a
 * column, so what the agent sees and what the 3D view shows cannot disagree.
 */

// listEvents pages from the OLDEST event forward, so a small limit truncates
// the newest rows — which is exactly where the upcoming shifts live. Same bound
// app/api/digest uses.
const EVENT_SCAN_LIMIT = 2000

export interface ShiftStatus {
  now: string
  upcoming: Shift[]
  short: Shift[]
}

export async function readShiftStatus(
  now: Date = new Date(),
): Promise<ShiftStatus> {
  const events = await listEvents(EVENT_SCAN_LIMIT)
  const upcoming = deriveShifts(events, now)

  return {
    now: now.toISOString(),
    upcoming,
    short: upcoming.filter((shift) => shift.short > 0),
  }
}

/**
 * Triage order: biggest gap first, then soonest.
 *
 * Not calendar order. A shift missing three people is a different problem from
 * one missing one, and the coordinator's scarce resource is attention, not
 * information (prd.md section 3). Calendar order would spend a run on the
 * nearest one-person gap and never reach the slot that is actually failing.
 */
export function mostUrgentGap(shifts: Shift[]): Shift | null {
  const ranked = [...shifts]
    .filter((shift) => shift.short > 0)
    .sort((a, b) => b.short - a.short || a.startsAt.localeCompare(b.startsAt))

  return ranked[0] ?? null
}

export const getShiftStatus = tool({
  name: 'get_shift_status',
  description:
    'List upcoming shifts and how many people each one is short of its minimum. Use this to find out which shifts need attention.',
  inputSchema: z.object({
    onlyShort: z
      .boolean()
      .optional()
      .describe('When true, return only shifts that are below minimum coverage.'),
  }),
  callback: async (input) => {
    const status = await readShiftStatus()
    return {
      now: status.now,
      shifts: input.onlyShort ? status.short : status.upcoming,
    }
  },
})
