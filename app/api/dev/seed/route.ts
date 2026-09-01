import { seed } from '@/lib/seed'
import { countEvents } from '@/lib/db/queries'
import { isLocalDb } from '@/lib/db/client'

/**
 * Reseeds the demo scenario. Destructive.
 *
 * This is a route rather than a local script because the deployed database is
 * Turso and Vercel gives you no shell — the same code path has to work in both
 * places, or "seeded locally, empty in production" becomes a demo-day surprise.
 *
 * Guarded by CRON_SECRET whenever a real database is configured.
 */

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

function authorized(request: Request): boolean {
  if (isLocalDb()) return true
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const started = Date.now()

  try {
    const result = await seed()
    return Response.json({
      ok: true,
      elapsedMs: Date.now() - started,
      ...result,
      eventsInDb: await countEvents(),
    })
  } catch (error) {
    return Response.json(
      {
        ok: false,
        elapsedMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
