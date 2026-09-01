import { runLoop } from '@/lib/agent/core'
import type { TriggerResponse } from '@/lib/types'

/**
 * Scheduled agent run, architecture.md section 3.7. Same loop as the manual
 * trigger; this one only has to prove the thing runs unattended.
 *
 * Guarded by CRON_SECRET — unlike /api/trigger/loop, nothing about this route
 * needs to be reachable by a judge with no credentials.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET

  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const started = Date.now()
  const result = await runLoop()

  const body: TriggerResponse = {
    ok: result.ok,
    elapsedMs: Date.now() - started,
    writtenEventIds: result.writtenEventIds,
    summary: result.summary,
    ...(result.error ? { error: result.error } : {}),
  }

  return Response.json(body)
}
