import { runReflection, buildBrief, renderBrief } from '@/lib/agent/reflection'

/**
 * Manual reflection run — the demo trigger.
 *
 * Unauthenticated on purpose. design.md section 5 puts a run button in front of
 * judges who have no credentials, and architecture.md section 3.7 keeps the
 * manual triggers because a video of the agent working beats a video of someone
 * waiting for a cron.
 *
 * GET returns the pre-aggregated brief without calling the model. That is a
 * debugging surface, not a product one: it is how you check the signal is still
 * in the data after a reseed without spending a token.
 */

export const runtime = 'nodejs'

/**
 * architecture.md section 3.4 names serverless timeout as the main gotcha of
 * this stack, so the limit is explicit from the first version rather than
 * discovered in production. The pass is one model call over a ~40 line brief;
 * 60s is the Vercel Hobby ceiling and far more headroom than it needs.
 */
export const maxDuration = 60
export const dynamic = 'force-dynamic'

export async function POST() {
  const result = await runReflection()
  return Response.json(result, { status: result.ok ? 200 : 500 })
}

export async function GET() {
  const started = Date.now()

  try {
    const brief = await buildBrief()
    return Response.json({
      ok: true,
      elapsedMs: Date.now() - started,
      eventsConsidered: brief.eventsConsidered,
      offeredEventIds: brief.offeredEventIds.length,
      brief,
      prompt: renderBrief(brief),
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
