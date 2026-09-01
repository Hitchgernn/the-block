import { WebClient } from '@slack/web-api'
import { tool } from '@strands-agents/sdk'
import { z } from 'zod'
import { insertEvent } from '@/lib/db/queries'
import type { AskSentPayload } from '@/lib/types'

/**
 * Act step — the notifier, architecture.md section 3.5.
 *
 * This function never throws. If Slack is unconfigured or the call fails the
 * ask still lands in the event log with `delivered: false`, which is the outbox
 * fallback section 3.5 describes: the app can render it as a simulated inbox
 * and the demo keeps moving. Architecture principle 4 — degrade, don't break.
 */

export interface AskDelivery {
  /** Null only if the event write itself failed. */
  eventId: number | null
  volunteerId: string
  volunteerName: string
  delivered: boolean
  channel: string | null
  /** Present when delivery failed. Plain text, no apology (design.md 7). */
  reason?: string
}

// Undefined = not looked at yet, null = looked and there is no token.
let client: WebClient | null | undefined

function slack(): WebClient | null {
  if (client !== undefined) return client
  const token = process.env.SLACK_BOT_TOKEN
  client = token ? new WebClient(token) : null
  return client
}

export async function deliverAsk(input: {
  volunteerId: string
  volunteerName: string
  slackHandle?: string | null
  slot: string
  shiftId: string
  message: string
  rationale: string
}): Promise<AskDelivery> {
  const channel = process.env.SLACK_CHANNEL_ID ?? null
  const web = slack()

  let delivered = false
  let reason: string | undefined

  if (!web) {
    reason = 'SLACK_BOT_TOKEN is not set'
  } else if (!channel) {
    reason = 'SLACK_CHANNEL_ID is not set'
  } else {
    try {
      await web.chat.postMessage({
        channel,
        text: input.slackHandle
          ? `${input.slackHandle} ${input.message}`
          : input.message,
      })
      delivered = true
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error)
    }
  }

  // Exactly the shape lib/types.ts pins and app/api/digest reads. Extra keys are
  // allowed by SlotPayload; the five named ones are not optional.
  const payload: AskSentPayload = {
    slot: input.slot,
    volunteerName: input.volunteerName,
    message: input.message,
    rationale: input.rationale,
    delivered,
  }
  if (reason) payload.undeliveredReason = reason

  let eventId: number | null = null
  try {
    eventId = await insertEvent({
      type: 'ask_sent',
      volunteerId: input.volunteerId,
      shiftId: input.shiftId,
      payload,
      importance: 4,
    })
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error)
  }

  return {
    eventId,
    volunteerId: input.volunteerId,
    volunteerName: input.volunteerName,
    delivered,
    channel,
    ...(reason ? { reason } : {}),
  }
}

export const sendAsk = tool({
  name: 'send_ask',
  description:
    'Send one volunteer a message asking them to cover a specific shift, and record the ask in the event log. One call per person — never a broadcast.',
  inputSchema: z.object({
    volunteerId: z.string().describe('Volunteer id, for example "v-maria".'),
    volunteerName: z.string().describe('Their name, as it appears in the record.'),
    slackHandle: z
      .string()
      .nullable()
      .optional()
      .describe('Their Slack handle, for example "@maria".'),
    slot: z.string().describe('The slot label, for example "Saturday 9am".'),
    shiftId: z.string().describe('The dated shift, for example "sat9-2026-09-05".'),
    message: z
      .string()
      .describe('The message to send this person. Written for them specifically.'),
    rationale: z
      .string()
      .describe('One sentence on why this person, drawn from the record.'),
  }),
  callback: (input) => deliverAsk(input),
})
