import { countEvents, listEvents } from '@/lib/db/queries'
import type { EventsResponse } from '@/lib/types'

/**
 * Raw event log. Deliberately unglamorous — this is shown on camera to prove
 * the reflections came from real logged events (architecture.md section 6).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = Number(
    new URL(request.url).searchParams.get('limit') ?? '500',
  )

  const [events, total] = await Promise.all([
    listEvents(Number.isFinite(limit) ? limit : 500),
    countEvents(),
  ])

  const body: EventsResponse = {
    generatedAt: new Date().toISOString(),
    events,
    total,
  }

  return Response.json(body)
}
