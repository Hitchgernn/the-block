'use client'

import { useMemo, useState } from 'react'
import type {
  AgentAction,
  DigestResponse,
  EventRecord,
  Plot,
  ReflectionWithSources,
  Shift,
} from '@/lib/types'
import {
  describePlot,
  numberWord,
  plural,
  shortDate,
} from '@/components/scene-utils'

interface DigestProps {
  digest: DigestResponse | null
  plots: Plot[]
  open: boolean
  onClose: () => void
}

function joinNames(names: string[]): string {
  if (names.length === 0) return 'nobody yet'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function firstName(full: string): string {
  return full.split(' ')[0]
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function Sources({
  reflection,
  names,
}: {
  reflection: ReflectionWithSources
  names: Map<string, string>
}) {
  const [open, setOpen] = useState(false)
  const count = reflection.sources.length
  const regionId = `sources-${reflection.id}`

  return (
    <>
      <button
        type="button"
        className="disclose"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((value) => !value)}
      >
        {open
          ? 'Hide the events behind this'
          : `Show the ${numberWord(count)} ${plural(
              count,
              'event',
              'events',
            )} behind this`}
      </button>
      {open ? (
        <ul className="sources" id={regionId}>
          {reflection.sources.map((source: EventRecord) => (
            <li key={source.id}>
              <div className="src-head">{describeEvent(source, names)}</div>
              <code>
                #{source.id} · {source.type} · {shortDate(source.ts)}
              </code>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}

function describeEvent(event: EventRecord, names: Map<string, string>): string {
  const who = event.volunteerId ? names.get(event.volunteerId) : null
  const slot = typeof event.payload.slot === 'string' ? event.payload.slot : null
  switch (event.type) {
    case 'shift_completed':
      return `${who ?? 'Someone'} covered ${slot ?? 'a shift'}.`
    case 'no_show':
      return `${who ?? 'Someone'} did not make ${slot ?? 'a shift'}.`
    case 'shift_short':
      return `${slot ?? 'A shift'} ran short.`
    case 'shift_opened':
      return `${slot ?? 'A shift'} opened.`
    case 'ask_sent':
      return `Asked ${who ?? 'a volunteer'} about ${slot ?? 'a shift'}.`
    case 'ask_accepted':
      return `${who ?? 'Someone'} said yes to ${slot ?? 'a shift'}.`
    case 'ask_declined':
      return `${who ?? 'Someone'} could not make ${slot ?? 'a shift'}.`
    case 'agent_reasoning':
      return `The agent worked through ${slot ?? 'the schedule'}.`
    default:
      return `${slot ?? 'An event'} was logged.`
  }
}

function Action({ action }: { action: AgentAction }) {
  const shortNames = action.askedNames.map(firstName)
  return (
    <div className="entry">
      <p className="entry-body">
        Asked {joinNames(shortNames)} about {action.slot ?? 'an open shift'}.
      </p>
      <p className="entry-meta">{shortDate(action.ts)}</p>
      {action.reasoning ? <p className="reason">{action.reasoning}</p> : null}
    </div>
  )
}

function OpenShift({ shift }: { shift: Shift }) {
  return (
    <div className="entry">
      <p className="entry-body">
        {shift.slot} on {shortDate(shift.startsAt)} is short{' '}
        {numberWord(shift.short)} {plural(shift.short, 'person', 'people')}.
      </p>
      <p className="entry-meta">
        {numberWord(shift.committed)} of {numberWord(shift.minimum)} committed
        so far.
      </p>
    </div>
  )
}

/**
 * docs/design.md section 6. Fixed order, typography only, no cards or icons.
 * The last section is the accessibility floor: everything the 3D scene says,
 * said again as text.
 */
export default function Digest({ digest, plots, open, onClose }: DigestProps) {
  const names = useMemo(
    () => new Map(plots.map((plot) => [plot.volunteerId, plot.name])),
    [plots],
  )
  const ordered = useMemo(
    () =>
      [...plots].sort(
        (a, b) => b.stage - a.stage || a.name.localeCompare(b.name),
      ),
    [plots],
  )

  return (
    <aside
      className="digest"
      data-open={open}
      aria-hidden={!open}
      aria-label="Coordinator digest"
    >
      <div className="digest-inner">
        <div className="digest-top">
          <p className="entry-meta">
            Coordinator digest
            {digest ? ` · updated ${timeOf(digest.generatedAt)}` : ''}
          </p>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>

        <section aria-labelledby="digest-noticed">
          <h3 id="digest-noticed">What the agent noticed</h3>
          {digest && digest.noticed.length > 0 ? (
            digest.noticed.map((reflection) => (
              <div className="entry" key={reflection.id}>
                <p className="entry-body">{reflection.text}</p>
                <p className="entry-meta">
                  {reflection.kind} · {shortDate(reflection.ts)}
                </p>
                <Sources reflection={reflection} names={names} />
              </div>
            ))
          ) : (
            <p className="empty">
              The agent has not run yet. What it notices shows up here, with
              the logged events behind each line.
            </p>
          )}
        </section>

        <section aria-labelledby="digest-did">
          <h3 id="digest-did">What the agent did</h3>
          {digest && digest.did.length > 0 ? (
            digest.did.map((action) => (
              <Action key={action.eventId} action={action} />
            ))
          ) : (
            <p className="empty">
              No asks sent yet. Run the agent and every message it sends lands
              here, with its reason for picking that person.
            </p>
          )}
        </section>

        <section aria-labelledby="digest-open">
          <h3 id="digest-open">What&rsquo;s still open</h3>
          {digest && digest.stillOpen.length > 0 ? (
            digest.stillOpen.map((shift) => (
              <OpenShift key={shift.id} shift={shift} />
            ))
          ) : (
            <p className="empty">Every upcoming shift has enough hands.</p>
          )}
        </section>

        <section aria-labelledby="digest-block">
          <h3 id="digest-block">The block, in words</h3>
          {plots.length > 0 ? (
            <ul className="plotlist">
              {ordered.map((plot) => (
                <li key={plot.volunteerId}>
                  <span className="who">{plot.name}</span>
                  <br />
                  {describePlot(plot)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">
              No shifts logged yet. The block fills in as people show up.
            </p>
          )}
        </section>
      </div>
    </aside>
  )
}
