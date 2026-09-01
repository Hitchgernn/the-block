import { listEvents, listVolunteers } from '@/lib/db/queries'
import { derivePlots, deriveShifts, deriveActivity } from '@/lib/db/derive'
import type { StateResponse } from '@/lib/types'

/** Derived world state for The Block. Everything the scene needs, one call. */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const now = new Date()
  const [volunteers, events] = await Promise.all([
    listVolunteers(),
    listEvents(2000),
  ])

  const plots = derivePlots(volunteers, events, now)

  const body: StateResponse = {
    generatedAt: now.toISOString(),
    plots,
    upcomingShifts: deriveShifts(events, now),
    recentActivity: deriveActivity(volunteers, events),
    totals: {
      volunteers: volunteers.length,
      completedShifts: plots.reduce((sum, p) => sum + p.completedShifts, 0),
      litPlots: plots.filter((p) => p.stage === 4).length,
    },
  }

  return Response.json(body)
}
