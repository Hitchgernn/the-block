import type { Shift } from '@/lib/types'
import type { CandidateMemory, SlotMemory } from '@/lib/agent/tools/memory'

/**
 * Prompts for the decide step.
 *
 * The copy rules below are design.md section 7 restated for the model. They are
 * in the system prompt rather than applied afterwards because every Slack
 * message the agent writes goes straight to a real volunteer — there is no
 * editorial pass between the model and the person reading it.
 */

const COPY_RULES = `How to write, without exception:
- Plain verbs, sentence case, no filler.
- Warmth about people. No drama about gaps.
- No emoji. No exclamation marks. No capitalised alarm words.
- Write "Saturday 9am is short two people." Never "CRITICAL COVERAGE ALERT".
- Never mention points, scores, streaks, leaderboards or rankings.
- Never guilt anyone or reference how long it has been since they came. A
  missed month is life happening, not a lapse to explain.
- Two or three sentences. Ask, and make it easy to say no.`

export const DECIDE_SYSTEM_PROMPT = `You help the volunteer coordinator at a small food bank keep shifts covered.

A shift is below its minimum. Your job is to decide which specific people to ask, and to write each of them their own message.

How to decide:
- Read the record you are given. Every claim you make about a person must come from it.
- Prefer people the record actually supports: they have covered this slot, they turned up when they said they would, they list it as a slot they like.
- Do not ask anyone who is already signed up for this shift.
- Do not ask someone who was contacted in the last few days unless the record gives you a reason to.
- Someone who has been quiet for weeks is still worth asking. Quiet is not a strike against them.
- Ask a few more people than the gap, because not everyone will say yes. Do not ask everyone — a message that went to the whole list is not a decision.

How to write each message:
- Address one person. Name the slot and the date. Say plainly how short it is.
- Say the one true thing that made you think of them, drawn from the record.
- Never send the same sentence to two people.

${COPY_RULES}

Explain your reasoning in two to four sentences: how you read the gap, who you chose and why, and who you deliberately passed over. This is read by the coordinator, so write it for a person, not as a log line.`

function describeDate(iso: string): string {
  return iso.slice(0, 10)
}

function describeCandidate(candidate: CandidateMemory): string {
  const parts: string[] = [`${candidate.volunteerId} — ${candidate.name}`]

  parts.push(
    candidate.timesCoveredSlot > 0
      ? `covered this slot ${candidate.timesCoveredSlot} time(s), last on ${describeDate(candidate.lastCoveredSlotAt ?? '')}`
      : 'has not covered this slot',
  )
  if (candidate.prefersSlot) parts.push('lists this slot as one they like')
  if (candidate.noShowsInSlot > 0) {
    parts.push(`did not turn up ${candidate.noShowsInSlot} time(s)`)
  }
  parts.push(
    candidate.lastAskedAt
      ? `last asked ${describeDate(candidate.lastAskedAt)}`
      : 'never asked before',
  )
  if (candidate.alreadyCommitted) parts.push('ALREADY SIGNED UP for this shift')

  return `- ${parts.join('; ')}`
}

/**
 * The retrieved context, rendered as text rather than raw JSON. Prose reads
 * better in the trace we log for the demo, and it costs fewer tokens than the
 * same facts wrapped in braces.
 */
export function buildDecidePrompt(
  shift: Shift,
  memory: SlotMemory,
  maxAsks: number,
): string {
  const sections: string[] = []

  sections.push(
    [
      'THE GAP',
      `${shift.slot} on ${describeDate(shift.startsAt)} (shift id ${shift.id})`,
      `Needs ${shift.minimum}, has ${shift.committed}, short ${shift.short}.`,
    ].join('\n'),
  )

  sections.push(
    [
      'WHAT THE AGENT HAS NOTICED SO FAR',
      memory.reflections.length
        ? memory.reflections
            .map((r) => `- [${r.kind}] ${r.text}`)
            .join('\n')
        : '- Nothing recorded yet.',
    ].join('\n'),
  )

  sections.push(
    [
      `RECENT ACTIVITY IN ${shift.slot.toUpperCase()} (newest first)`,
      memory.history.length
        ? memory.history
            .map(
              (item) =>
                `- ${describeDate(item.ts)} ${item.type}${item.who ? ` — ${item.who}` : ''}${item.detail ? ` (${item.detail})` : ''}`,
            )
            .join('\n')
        : '- No history for this slot.',
    ].join('\n'),
  )

  sections.push(
    [
      'PEOPLE IN THE RECORD FOR THIS SLOT — use these ids exactly',
      memory.candidates.length
        ? memory.candidates.map(describeCandidate).join('\n')
        : '- Nobody in the record has any connection to this slot.',
      'Anyone marked as already signed up is here for context only. The',
      'structured output will not accept their id.',
    ].join('\n'),
  )

  sections.push(
    [
      'WHAT TO RETURN',
      `Choose between 1 and ${maxAsks} people and write one message each.`,
      'Return the decision through the structured output tool.',
    ].join('\n'),
  )

  return sections.join('\n\n')
}
