import { Agent, BedrockModel } from '@strands-agents/sdk'
import { z } from 'zod'
import { DECIDE_SYSTEM_PROMPT, buildDecidePrompt } from '@/lib/agent/prompts'
import { queryMemory, type SlotMemory } from '@/lib/agent/tools/memory'
import { sendAsk } from '@/lib/agent/tools/notify'
import { logEvent } from '@/lib/agent/tools/scoring'
import { getShiftStatus, mostUrgentGap } from '@/lib/agent/tools/shifts'
import type { AgentReasoningPayload, Shift } from '@/lib/types'

/**
 * The agent core loop, architecture.md section 3.1:
 * observe -> retrieve -> decide -> act -> log.
 *
 * Observe, retrieve and act run through the tools rather than round them, so
 * the five tools in section 3.1 are the single implementation of those steps
 * whether the model calls them or the loop does. Decide is a real model call
 * with the retrieved context in the prompt and a Zod structured output schema —
 * section 3.1 is explicit that a ranking function here would be the wrong
 * thing, and the schema retry is the free reliability the demo path needs.
 */

// Ask a couple more people than the gap: not everyone says yes, and asking the
// whole list would be a broadcast rather than a decision (prd.md F4).
const EXTRA_ASKS = 2

const NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five',
  'six', 'seven', 'eight', 'nine', 'ten',
]

export interface Decision {
  reasoning: string
  asks: { volunteerId: string; message: string; rationale: string }[]
  passedOver?: string[]
}

export interface LoopResult {
  ok: boolean
  writtenEventIds: number[]
  summary: string
  slot: string | null
  shiftId: string | null
  error?: string
}

function spell(count: number): string {
  return NUMBER_WORDS[count] ?? String(count)
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * The decide step. The only model call in the loop.
 *
 * Askable ids go into the schema as an enum, so a hallucinated or
 * already-signed-up name fails validation and the SDK retries the model with
 * the error rather than the loop messaging a person who does not exist.
 */
async function decide(
  shift: Shift,
  memory: SlotMemory,
  askableIds: string[],
): Promise<Decision> {
  const maxAsks = Math.min(shift.short + EXTRA_ASKS, askableIds.length)

  const schema = z.object({
    reasoning: z
      .string()
      .describe(
        'Two to four sentences for the coordinator: how you read the gap, who you chose, who you passed over and why.',
      ),
    asks: z
      .array(
        z.object({
          volunteerId: z
            .enum(askableIds)
            .describe('Copy the id exactly from the list of people you may ask.'),
          message: z
            .string()
            .describe(
              'The Slack message for this one person. Never the same wording as another message.',
            ),
          rationale: z
            .string()
            .describe('One sentence: why this person, from the record.'),
        }),
      )
      .min(1)
      .max(maxAsks)
      .describe('One entry per person you are asking.'),
    passedOver: z
      .array(z.enum(askableIds))
      .optional()
      .describe('Ids you considered and decided not to ask.'),
  })

  const agent = new Agent({
    model: new BedrockModel({
      region: process.env.AWS_REGION,
      modelId: process.env.BEDROCK_MODEL_ID,
      maxTokens: 4096,
      // Low, not zero: the messages have to differ from each other, but the
      // choice of who to ask should not wander between runs of the same demo.
      temperature: 0.3,
    }),
    systemPrompt: DECIDE_SYSTEM_PROMPT,
    // The context is already in the prompt; these let the model check something
    // it is unsure of rather than guess.
    tools: [getShiftStatus, queryMemory],
    structuredOutputSchema: schema,
    // sdk-notes.md section 1: defaults to true and would write the whole
    // reasoning stream to the serverless log on every invocation.
    printer: false,
  })

  const result = await agent.invoke(buildDecidePrompt(shift, memory, maxAsks))

  return schema.parse(result.structuredOutput)
}

export async function runLoop(): Promise<LoopResult> {
  const written: number[] = []
  let shift: Shift | null = null

  try {
    // 1. observe
    const status = await getShiftStatus.invoke({ onlyShort: true })
    shift = mostUrgentGap(status.shifts)

    if (!shift) {
      return {
        ok: true,
        writtenEventIds: [],
        summary: 'No upcoming shift is below its minimum.',
        slot: null,
        shiftId: null,
      }
    }

    // 2. retrieve
    const memory = await queryMemory.invoke({
      slot: shift.slot,
      shiftId: shift.id,
    })

    const askable = memory.candidates.filter(
      (candidate) => !candidate.alreadyCommitted,
    )

    if (askable.length === 0) {
      return {
        ok: false,
        writtenEventIds: [],
        summary: `${shift.slot} is short ${spell(shift.short)}, and everyone in the record is already signed up for it.`,
        slot: shift.slot,
        shiftId: shift.id,
        error: 'no askable candidates',
      }
    }

    // 3. decide
    const decision = await decide(
      shift,
      memory,
      askable.map((candidate) => candidate.volunteerId),
    )

    // 5. log — written before the asks go out. The reasoning is the demo asset
    // (architecture.md section 3.1 step 5) and a Slack stall must not lose it.
    const reasoning: AgentReasoningPayload = {
      slot: shift.slot,
      reasoning: decision.reasoning,
      chose: decision.asks.map((ask) => ask.volunteerId),
      passedOver: decision.passedOver,
      contextEventCount: memory.contextEventCount,
    }

    written.push(
      await logEvent.invoke({
        type: 'agent_reasoning',
        shiftId: shift.id,
        payload: reasoning,
        importance: 4,
      }),
    )

    // 4. act
    const byId = new Map(askable.map((candidate) => [candidate.volunteerId, candidate]))
    const asked: string[] = []
    let undelivered = 0

    for (const ask of decision.asks) {
      const candidate = byId.get(ask.volunteerId)
      if (!candidate) continue

      const delivery = await sendAsk.invoke({
        volunteerId: candidate.volunteerId,
        volunteerName: candidate.name,
        slackHandle: candidate.slackHandle,
        slot: shift.slot,
        shiftId: shift.id,
        message: ask.message,
        rationale: ask.rationale,
      })

      if (delivery.eventId !== null) written.push(delivery.eventId)
      if (!delivery.delivered) undelivered += 1
      asked.push(candidate.name)
    }

    // design.md section 7: plain, no drama, warmth about the people named.
    const summary = [
      `${shift.slot} is short ${spell(shift.short)}.`,
      asked.length ? `Asked ${joinNames(asked)}.` : 'Nobody was asked.',
      undelivered
        ? 'Slack was not reachable, so the asks are in the event log.'
        : '',
    ]
      .filter(Boolean)
      .join(' ')

    return {
      ok: true,
      writtenEventIds: written,
      summary,
      slot: shift.slot,
      shiftId: shift.id,
    }
  } catch (error) {
    // Principle 4, degrade don't break: report what happened and keep whatever
    // was already written. No fallback ranking — an ask the model did not make
    // must never be presented as one it did.
    return {
      ok: false,
      writtenEventIds: written,
      summary: shift
        ? `The run stopped before finishing ${shift.slot}.`
        : 'The run stopped before it could look at any shift.',
      slot: shift?.slot ?? null,
      shiftId: shift?.id ?? null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
