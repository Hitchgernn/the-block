import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import { countEvents, listVolunteers } from '@/lib/db/queries'
import { isLocalDb } from '@/lib/db/client'
import { slackToken } from '@/lib/agent/tools/notify'

/**
 * What is actually wired up, right now, on this deployment.
 *
 * Replaces the day-1 Bedrock spike route. The spike proved one model call
 * worked from a route handler; this answers the question that matters for the
 * rest of the project — when something fails on the deployed URL, is it the
 * database, the credentials, the model id, or the code?
 *
 * Reports rather than throws: a health check that 500s tells you less than one
 * that says which leg is missing.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface Check {
  ok: boolean
  detail: string
}

async function checkDatabase(): Promise<Check> {
  try {
    const [events, volunteers] = await Promise.all([
      countEvents(),
      listVolunteers(),
    ])
    const where = isLocalDb() ? 'local file' : 'turso'
    if (events === 0) {
      return {
        ok: false,
        detail: `connected to ${where} but empty — POST /api/dev/seed`,
      }
    }
    return {
      ok: true,
      detail: `${where}: ${volunteers.length} volunteers, ${events} events`,
    }
  } catch (error) {
    return { ok: false, detail: message(error) }
  }
}

/**
 * Resolving credentials is the failure we actually hit, so it is checked
 * separately from the model call. No tokens are spent: the Bedrock client is
 * constructed and the AWS credential chain resolved, nothing is invoked.
 */
async function checkBedrock(): Promise<Check> {
  const region = process.env.AWS_REGION
  const modelId = process.env.BEDROCK_MODEL_ID

  if (!region) return { ok: false, detail: 'AWS_REGION is not set' }

  try {
    // BedrockModel keeps its client private, so the credential chain is
    // resolved through the same runtime client the SDK builds internally.
    const client = new BedrockRuntimeClient({ region })
    const credentials = await client.config.credentials()
    return {
      ok: true,
      detail:
        `${region} · ${modelId ?? 'sdk default model'} · credentials resolved` +
        ` (${credentials.accessKeyId.slice(0, 4)}…)`,
    }
  } catch (error) {
    return { ok: false, detail: message(error) }
  }
}

function checkSlack(): Check {
  // Shares the agent's own token check, so health cannot report Slack as ready
  // on a placeholder the notifier would reject.
  const token = slackToken()
  const channel = process.env.SLACK_CHANNEL_ID
  if (!token) {
    return {
      ok: false,
      detail: 'SLACK_BOT_TOKEN unset or placeholder — asks go to the outbox',
    }
  }
  if (!channel) return { ok: false, detail: 'SLACK_CHANNEL_ID is not set' }
  return { ok: true, detail: `token present, channel ${channel}` }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function GET() {
  const [database, bedrock] = await Promise.all([checkDatabase(), checkBedrock()])
  const slack = checkSlack()

  const checks = { database, bedrock, slack }

  return Response.json({
    // Slack is allowed to be missing: sendAsk falls back to the outbox, so the
    // demo path still runs without it (architecture.md section 3.5).
    ok: database.ok && bedrock.ok,
    checks,
    cronSecretSet: Boolean(process.env.CRON_SECRET),
  })
}
