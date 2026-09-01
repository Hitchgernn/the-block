import { tool } from '@strands-agents/sdk'
import { z } from 'zod'
import { listReflections, listVolunteers, queryEvents } from '@/lib/db/queries'
import type { EventRecord, ReflectionKind } from '@/lib/types'

/**
 * Retrieve step, architecture.md sections 3.1 and 3.3.
 *
 * Simple retrieval only: filter by relevance (same slot, same shift, same
 * volunteer), sort by recency, cap at N. The recency + importance + relevance
 * scoring function from the Generative Agents paper is stretch S2 and is
 * deliberately not here.
 *
 * Nothing in this file ranks candidates for the agent. It gathers facts and
 * caps them; choosing is the model's job (architecture.md principle 2).
 */

const SLOT_EVENT_LIMIT = 200
const SHIFT_EVENT_LIMIT = 100
const RECENT_ASK_LIMIT = 100
const REFLECTION_LIMIT = 8
const HISTORY_LIMIT = 24
const CANDIDATE_LIMIT = 12

export interface CandidateMemory {
  volunteerId: string
  name: string
  slackHandle: string | null
  /** They list this slot in their preferences. */
  prefersSlot: boolean
  timesCoveredSlot: number
  lastCoveredSlotAt: string | null
  noShowsInSlot: number
  /** Last time the agent asked them anything, any slot. Avoids pestering. */
  lastAskedAt: string | null
  /** Already signed up for the shift in question, so not worth asking. */
  alreadyCommitted: boolean
}

export interface HistoryItem {
  ts: string
  type: string
  who: string | null
  detail: string
}

export interface SlotMemory {
  slot: string
  shiftId: string | null
  reflections: { ts: string; kind: ReflectionKind; text: string }[]
  history: HistoryItem[]
  candidates: CandidateMemory[]
  /** Distinct events read into this context. Goes into AgentReasoningPayload. */
  contextEventCount: number
}

/**
 * Who is already down for this shift. derive.ts answers how many; this answers
 * who, which is the question that stops the agent asking someone twice.
 */
function committedTo(shiftEvents: EventRecord[]): Set<string> {
  const people = new Set<string>()

  // queryEvents returns newest first; walk oldest first so a no_show cancels
  // the acceptance that came before it.
  for (const event of [...shiftEvents].reverse()) {
    if (!event.volunteerId) continue
    if (event.type === 'ask_accepted' || event.type === 'shift_completed') {
      people.add(event.volunteerId)
    } else if (event.type === 'no_show') {
      people.delete(event.volunteerId)
    }
  }

  return people
}

export async function recallForSlot(params: {
  slot: string
  shiftId?: string | null
}): Promise<SlotMemory> {
  const shiftId = params.shiftId ?? null

  const [volunteers, slotEvents, shiftEvents, recentAsks, reflections] =
    await Promise.all([
      listVolunteers(),
      queryEvents({ slot: params.slot, limit: SLOT_EVENT_LIMIT }),
      shiftId
        ? queryEvents({ shiftId, limit: SHIFT_EVENT_LIMIT })
        : Promise.resolve([]),
      queryEvents({ types: ['ask_sent'], limit: RECENT_ASK_LIMIT }),
      listReflections(REFLECTION_LIMIT),
    ])

  const nameOf = new Map(volunteers.map((v) => [v.id, v.name]))
  const committed = committedTo(shiftEvents)

  const lastAsked = new Map<string, string>()
  for (const event of recentAsks) {
    // Newest first, so the first sighting of a volunteer is their latest ask.
    if (event.volunteerId && !lastAsked.has(event.volunteerId)) {
      lastAsked.set(event.volunteerId, event.ts)
    }
  }

  const covered = new Map<string, { count: number; last: string }>()
  const noShows = new Map<string, number>()

  for (const event of slotEvents) {
    if (!event.volunteerId) continue

    if (event.type === 'shift_completed') {
      const seen = covered.get(event.volunteerId)
      covered.set(event.volunteerId, {
        count: (seen?.count ?? 0) + 1,
        // Newest first, so the first one wins.
        last: seen?.last ?? event.ts,
      })
    } else if (event.type === 'no_show') {
      noShows.set(event.volunteerId, (noShows.get(event.volunteerId) ?? 0) + 1)
    }
  }

  const candidates: CandidateMemory[] = volunteers
    .filter(
      (volunteer) =>
        volunteer.preferredSlots.includes(params.slot) ||
        covered.has(volunteer.id),
    )
    .map((volunteer) => {
      const history = covered.get(volunteer.id)
      return {
        volunteerId: volunteer.id,
        name: volunteer.name,
        slackHandle: volunteer.slackHandle,
        prefersSlot: volunteer.preferredSlots.includes(params.slot),
        timesCoveredSlot: history?.count ?? 0,
        lastCoveredSlotAt: history?.last ?? null,
        noShowsInSlot: noShows.get(volunteer.id) ?? 0,
        lastAskedAt: lastAsked.get(volunteer.id) ?? null,
        alreadyCommitted: committed.has(volunteer.id),
      }
    })
    // Relevance to the slot, then recency. This is the cap-at-N ordering from
    // section 3.3, not a recommendation — every candidate's raw counts go to
    // the model and it decides.
    .sort(
      (a, b) =>
        b.timesCoveredSlot - a.timesCoveredSlot ||
        (b.lastCoveredSlotAt ?? '').localeCompare(a.lastCoveredSlotAt ?? ''),
    )
    .slice(0, CANDIDATE_LIMIT)

  const history: HistoryItem[] = slotEvents
    .slice(0, HISTORY_LIMIT)
    .map((event) => ({
      ts: event.ts,
      type: event.type,
      who: event.volunteerId ? (nameOf.get(event.volunteerId) ?? null) : null,
      detail:
        event.type === 'shift_short'
          ? `${event.payload.showed ?? '?'} of ${event.payload.minimum ?? '?'} turned up`
          : (event.shiftId ?? ''),
    }))

  const distinct = new Set<number>()
  for (const event of [...slotEvents, ...shiftEvents, ...recentAsks]) {
    distinct.add(event.id)
  }

  return {
    slot: params.slot,
    shiftId,
    reflections: reflections.map((reflection) => ({
      ts: reflection.ts,
      kind: reflection.kind,
      text: reflection.text,
    })),
    history,
    candidates,
    contextEventCount: distinct.size,
  }
}

export const queryMemory = tool({
  name: 'query_memory',
  description:
    'Recall what the event log knows about a shift slot: who has covered it before, how often they turned up, who was asked recently, who is already signed up, and what reflections mention the slot.',
  inputSchema: z.object({
    slot: z.string().describe('The slot label, for example "Saturday 9am".'),
    shiftId: z
      .string()
      .optional()
      .describe(
        'The specific upcoming shift, for example "sat9-2026-09-05". Include it to find out who is already signed up.',
      ),
  }),
  callback: (input) => recallForSlot(input),
})
