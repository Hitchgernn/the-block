import type {
  ActivityItem,
  EventRecord,
  GrowthStage,
  Plot,
  Shift,
  Volunteer,
} from '@/lib/types'

/**
 * events -> plot state, points, streaks, shift coverage.
 *
 * Pure functions, no stored state, no I/O. This is what guarantees the 3D view
 * cannot drift from the event log (architecture.md section 3.2): if the scene
 * shows a building, an event caused it.
 */

const POINTS_PER_SHIFT = 10
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/** design.md section 4. Additive only — a plot never regresses. */
export function growthStage(completedShifts: number): GrowthStage {
  if (completedShifts >= 7) return 4
  if (completedShifts >= 4) return 3
  if (completedShifts >= 2) return 2
  if (completedShifts >= 1) return 1
  return 0
}

/** Monday-anchored week index, so "consecutive weeks" is well defined. */
function weekIndex(iso: string): number {
  return Math.floor(Date.parse(iso) / WEEK_MS)
}

/**
 * Consecutive weeks with at least one completed shift, counting back from the
 * volunteer's most recent completion. Deliberately not anchored to "now": a
 * streak pauses when someone stops, it is never broken or punished.
 * See prd.md section 7 — missing a week must never produce a penalty.
 */
export function streakWeeks(completedAt: string[]): number {
  if (completedAt.length === 0) return 0

  const weeks = [...new Set(completedAt.map(weekIndex))].sort((a, b) => b - a)

  let streak = 1
  for (let i = 1; i < weeks.length; i += 1) {
    if (weeks[i] === weeks[i - 1] - 1) streak += 1
    else break
  }
  return streak
}

/**
 * 0 = active this week, approaching 1 after ~8 quiet weeks. Drives window
 * dimming only. Never reaches 1 and never changes a stage — a returning
 * volunteer's lights come back up, which is the moment worth animating.
 */
export function quietness(lastActiveAt: string | null, now: Date): number {
  if (!lastActiveAt) return 1
  const weeksQuiet = (now.getTime() - Date.parse(lastActiveAt)) / WEEK_MS
  if (weeksQuiet <= 1) return 0
  return Math.min(0.85, (weeksQuiet - 1) / 8)
}

export function derivePlots(
  volunteers: Volunteer[],
  events: EventRecord[],
  now: Date = new Date(),
): Plot[] {
  const completionsByVolunteer = new Map<string, string[]>()

  for (const event of events) {
    if (event.type !== 'shift_completed' || !event.volunteerId) continue
    const list = completionsByVolunteer.get(event.volunteerId) ?? []
    list.push(event.ts)
    completionsByVolunteer.set(event.volunteerId, list)
  }

  return volunteers.map((volunteer) => {
    const completions = (completionsByVolunteer.get(volunteer.id) ?? []).sort()
    const completedShifts = completions.length
    const lastActiveAt = completions.at(-1) ?? null
    const streak = streakWeeks(completions)

    return {
      volunteerId: volunteer.id,
      name: volunteer.name,
      stage: growthStage(completedShifts),
      completedShifts,
      points: completedShifts * POINTS_PER_SHIFT,
      streakWeeks: streak,
      hasGarden: streak >= 4,
      quietness: quietness(lastActiveAt, now),
      lastActiveAt,
    }
  })
}

/**
 * Shifts are derived from `shift_opened` events rather than stored in their own
 * table, which keeps the append-only principle intact: coverage is a count of
 * acceptances and completions, not a mutable column someone can desync.
 */
export function deriveShifts(
  events: EventRecord[],
  now: Date = new Date(),
): Shift[] {
  const shifts = new Map<string, Shift>()

  for (const event of events) {
    if (event.type !== 'shift_opened' || !event.shiftId) continue
    shifts.set(event.shiftId, {
      id: event.shiftId,
      slot: String(event.payload.slot ?? 'Unknown slot'),
      startsAt: String(event.payload.startsAt ?? event.ts),
      minimum: Number(event.payload.minimum ?? 0),
      committed: 0,
      short: 0,
    })
  }

  // A volunteer counts once per shift, whether they accepted an ask or simply
  // turned up. A no_show cancels their acceptance.
  const credited = new Map<string, Set<string>>()

  for (const event of events) {
    if (!event.shiftId || !event.volunteerId) continue
    const shift = shifts.get(event.shiftId)
    if (!shift) continue

    const people = credited.get(event.shiftId) ?? new Set<string>()

    if (event.type === 'ask_accepted' || event.type === 'shift_completed') {
      people.add(event.volunteerId)
    } else if (event.type === 'no_show') {
      people.delete(event.volunteerId)
    }

    credited.set(event.shiftId, people)
  }

  for (const shift of shifts.values()) {
    shift.committed = credited.get(shift.id)?.size ?? 0
    shift.short = Math.max(0, shift.minimum - shift.committed)
  }

  return [...shifts.values()]
    .filter((shift) => Date.parse(shift.startsAt) >= now.getTime())
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
}

/**
 * Copy follows design.md section 7: plain verbs, sentence case, warmth about
 * people and no drama about gaps. Never "Great job! +10 points!".
 */
export function deriveActivity(
  volunteers: Volunteer[],
  events: EventRecord[],
  limit = 8,
): ActivityItem[] {
  const nameOf = new Map(volunteers.map((v) => [v.id, v.name]))

  const items: ActivityItem[] = []

  for (const event of [...events].reverse()) {
    if (items.length >= limit) break

    const name = event.volunteerId ? nameOf.get(event.volunteerId) : undefined
    const slot = event.payload.slot ? String(event.payload.slot) : null

    let text: string | null = null

    if (event.type === 'shift_completed' && name && slot) {
      text = `${name} covered ${slot}.`
    } else if (event.type === 'ask_accepted' && name && slot) {
      text = `${name} said yes to ${slot}.`
    } else if (event.type === 'shift_short' && slot) {
      const missing = Number(event.payload.short ?? 0)
      text = `${slot} is short ${missing === 1 ? 'one person' : `${missing} people`}.`
    }

    if (text) items.push({ eventId: event.id, ts: event.ts, text })
  }

  return items
}
