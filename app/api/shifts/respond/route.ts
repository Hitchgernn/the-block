import { z } from 'zod'
import { insertEvent, listEvents, listVolunteers } from '@/lib/db/queries'
import { recordCompletion } from '@/lib/agent/tools/scoring'
import type { EventType } from '@/lib/types'

/**
 * Record what actually happened on a shift.
 *
 * This closes the loop architecture.md section 6 step 5 depends on — "the Block
 * updates when the shift is covered". Without it nothing in the repo ever
 * produces a `shift_completed`, so an ask can go out and the scene can never
 * change in response.
 *
 * It is a real coordinator action rather than a demo stub: prd.md F2 is
 * explicitly about distinguishing who signed up from who showed up, and
 * recording attendance is the coordinator's job. In a full deployment the
 * `accepted` case would also arrive from a Slack reply (stretch S3).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RESPONSES = {
  accepted: { type: 'ask_accepted' as EventType, importance: 2 },
  declined: { type: 'ask_declined' as EventType, importance: 2 },
  completed: { type: 'shift_completed' as EventType, importance: 3 },
  no_show: { type: 'no_show' as EventType, importance: 4 },
}

const bodySchema = z.object({
  shiftId: z.string().min(1),
  volunteerId: z.string().min(1),
  response: z.enum(['accepted', 'declined', 'completed', 'no_show']),
})

export async function POST(request: Request) {
  let parsed
  try {
    parsed = bodySchema.parse(await request.json())
  } catch {
    return Response.json(
      { ok: false, error: 'Expected { shiftId, volunteerId, response }.' },
      { status: 400 },
    )
  }

  const [volunteers, events] = await Promise.all([
    listVolunteers(),
    listEvents(2000),
  ])

  const volunteer = volunteers.find((v) => v.id === parsed.volunteerId)
  if (!volunteer) {
    return Response.json(
      { ok: false, error: `No volunteer ${parsed.volunteerId}.` },
      { status: 404 },
    )
  }

  const opened = events.find(
    (event) => event.type === 'shift_opened' && event.shiftId === parsed.shiftId,
  )
  if (!opened) {
    return Response.json(
      { ok: false, error: `No shift ${parsed.shiftId}.` },
      { status: 404 },
    )
  }

  const slot = String(opened.payload.slot ?? '')

  // A completion goes through recordCompletion so points and stage come back
  // recomputed from the log — the caller never has to trust a stored number.
  if (parsed.response === 'completed') {
    const result = await recordCompletion({
      volunteerId: parsed.volunteerId,
      shiftId: parsed.shiftId,
      slot,
    })
    return Response.json({
      ok: true,
      eventId: result.eventId,
      name: volunteer.name,
      slot,
      completedShifts: result.completedShifts,
      stage: result.stage,
    })
  }

  const { type, importance } = RESPONSES[parsed.response]
  const eventId = await insertEvent({
    type,
    volunteerId: parsed.volunteerId,
    shiftId: parsed.shiftId,
    payload: { slot },
    importance,
  })

  return Response.json({ ok: true, eventId, name: volunteer.name, slot })
}
