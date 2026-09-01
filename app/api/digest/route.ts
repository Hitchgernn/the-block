import {
  getEventsByIds,
  listEvents,
  listReflections,
  listVolunteers,
} from '@/lib/db/queries'
import { deriveShifts } from '@/lib/db/derive'
import type {
  AgentAction,
  AgentReasoningPayload,
  AskSentPayload,
  DigestResponse,
  EventRecord,
  ReflectionWithSources,
} from '@/lib/types'

/**
 * The coordinator surface, in the order design.md section 6 specifies:
 * what the agent noticed, what it did, what's still open.
 *
 * The `sources` on each reflection are the demo asset — they are how you prove
 * on camera that an insight came from logged events rather than an LLM writing
 * a plausible sentence.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Group ask_sent events with the reasoning event from the same loop run. */
function buildActions(events: EventRecord[]): AgentAction[] {
  const asksByShift = new Map<string, EventRecord[]>()

  for (const event of events) {
    if (event.type !== 'ask_sent' || !event.shiftId) continue
    const list = asksByShift.get(event.shiftId) ?? []
    list.push(event)
    asksByShift.set(event.shiftId, list)
  }

  const reasoningByShift = new Map<string, EventRecord>()
  for (const event of events) {
    if (event.type !== 'agent_reasoning' || !event.shiftId) continue
    reasoningByShift.set(event.shiftId, event)
  }

  const actions: AgentAction[] = []

  for (const [shiftId, asks] of asksByShift) {
    const reasoningEvent = reasoningByShift.get(shiftId)
    const reasoning = reasoningEvent
      ? (reasoningEvent.payload as unknown as AgentReasoningPayload).reasoning
      : null

    const latest = asks.reduce((a, b) => (a.ts > b.ts ? a : b))

    actions.push({
      eventId: reasoningEvent?.id ?? latest.id,
      ts: latest.ts,
      shiftId,
      slot: String((latest.payload as unknown as AskSentPayload).slot ?? '') || null,
      askedNames: asks.map((ask) =>
        String((ask.payload as unknown as AskSentPayload).volunteerName ?? '?'),
      ),
      reasoning: reasoning ?? null,
    })
  }

  return actions.sort((a, b) => b.ts.localeCompare(a.ts))
}

export async function GET() {
  const now = new Date()
  const [reflections, events] = await Promise.all([
    listReflections(20),
    listEvents(2000),
  ])
  // Touch volunteers so an empty database still reports coherently.
  await listVolunteers()

  const noticed: ReflectionWithSources[] = await Promise.all(
    reflections.map(async (reflection) => ({
      ...reflection,
      sources: await getEventsByIds(reflection.sourceEventIds),
    })),
  )

  const body: DigestResponse = {
    generatedAt: now.toISOString(),
    noticed,
    did: buildActions(events),
    stillOpen: deriveShifts(events, now).filter((shift) => shift.short > 0),
  }

  return Response.json(body)
}
