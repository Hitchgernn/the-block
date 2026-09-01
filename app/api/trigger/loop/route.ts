import { runLoop } from '@/lib/agent/core'
import type { TriggerResponse } from '@/lib/types'

/**
 * Manual agent run — the demo trigger, architecture.md section 3.7.
 *
 * Deliberately unauthenticated. design.md section 5 puts a "Run the agent"
 * button in front of judges who have no credentials, and a judge who can make
 * the agent visibly act in one click scores it higher than one taking the
 * video's word for it.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// architecture.md section 3.4: serverless timeouts are the known failure mode of
// this stack, so the ceiling is stated rather than inherited.
export const maxDuration = 60

export async function POST() {
  const started = Date.now()
  const result = await runLoop()

  const body: TriggerResponse = {
    ok: result.ok,
    elapsedMs: Date.now() - started,
    writtenEventIds: result.writtenEventIds,
    summary: result.summary,
    ...(result.error ? { error: result.error } : {}),
  }

  // 200 even on a failed run. runLoop already caught whatever went wrong and
  // wrote a readable summary; a non-2xx here would make the overlay's fetch
  // throw and show the judge nothing at all.
  return Response.json(body)
}
