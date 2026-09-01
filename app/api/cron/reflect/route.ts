import { runReflection } from '@/lib/agent/reflection'

/**
 * Scheduled reflection pass. architecture.md section 3.7.
 *
 * Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`, so the guard is a
 * straight comparison. Strict by design: with no secret configured nothing gets
 * in. The unauthenticated demo path is /api/trigger/reflect, which exists
 * precisely so this one never has to be opened up.
 *
 * Cron's job here is modest — it proves the agent runs unattended. The demo
 * itself runs off the manual trigger.
 */

export const runtime = 'nodejs'

/** Explicit from the first version — architecture.md section 3.4. */
export const maxDuration = 60
export const dynamic = 'force-dynamic'

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const result = await runReflection()
  return Response.json(result, { status: result.ok ? 200 : 500 })
}
