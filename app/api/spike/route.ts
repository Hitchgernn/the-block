import { Agent, BedrockModel, tool } from '@strands-agents/sdk'
import { z } from 'zod'

// Day 1 spike per workflow.md Phase 0: prove one Zod-schema tool and one
// Bedrock call work from a deployed route handler. Deleted once the real
// agent loop lands in lib/agent/.

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const countVolunteers = tool({
  name: 'count_volunteers',
  description: 'Count how many volunteers are signed up for a given shift slot.',
  inputSchema: z.object({
    slot: z.string().describe('The shift slot, e.g. "Saturday 9am"'),
  }),
  callback: (input) => ({ slot: input.slot, signedUp: 4, minimum: 6 }),
})

export async function GET() {
  const started = Date.now()

  try {
    const agent = new Agent({
      model: new BedrockModel({
        region: process.env.AWS_REGION,
        modelId: process.env.BEDROCK_MODEL_ID,
        maxTokens: 512,
      }),
      systemPrompt:
        'You help a food bank volunteer coordinator. Be brief and concrete.',
      tools: [countVolunteers],
      printer: false,
    })

    const result = await agent.invoke(
      'Is Saturday 9am short on volunteers? Use the tool, then say by how many.',
    )

    return Response.json({
      ok: true,
      elapsedMs: Date.now() - started,
      region: process.env.AWS_REGION ?? null,
      modelId: process.env.BEDROCK_MODEL_ID ?? '(sdk default)',
      stopReason: result.stopReason,
      text: result.lastMessage.toString(),
    })
  } catch (error) {
    return Response.json(
      {
        ok: false,
        elapsedMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : undefined,
      },
      { status: 500 },
    )
  }
}
