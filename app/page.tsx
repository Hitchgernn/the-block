'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type {
  DigestResponse,
  Plot,
  StateResponse,
  TriggerResponse,
} from '@/lib/types'
import Digest from '@/components/Digest'
import Overlay from '@/components/Overlay'
import { describePlot, describeShift } from '@/components/scene-utils'

const Block = dynamic(() => import('@/components/Block'), { ssr: false })

const POLL_MS = 15000
const FADE_AFTER_MS = 14000

export default function Home() {
  const [state, setState] = useState<StateResponse | null>(null)
  const [digest, setDigest] = useState<DigestResponse | null>(null)
  const [overlayOpen, setOverlayOpen] = useState(true)
  const [digestOpen, setDigestOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [foodBankSelected, setFoodBankSelected] = useState(false)
  const [lightUpKeys, setLightUpKeys] = useState<Record<string, number>>({})
  const [runStatus, setRunStatus] = useState<string | null>(null)
  const [compact, setCompact] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [faded, setFaded] = useState(false)

  const seenShifts = useRef<Map<string, number> | null>(null)

  const refresh = useCallback(async () => {
    const [stateRes, digestRes] = await Promise.all([
      fetch('/api/state', { cache: 'no-store' }),
      fetch('/api/digest', { cache: 'no-store' }),
    ])
    if (stateRes.ok) {
      const next = (await stateRes.json()) as StateResponse
      const previous = seenShifts.current
      if (previous) {
        const bumped: string[] = []
        for (const plot of next.plots) {
          const before = previous.get(plot.volunteerId)
          if (before !== undefined && plot.completedShifts > before) {
            bumped.push(plot.volunteerId)
          }
        }
        if (bumped.length > 0) {
          setLightUpKeys((keys) => {
            const copy = { ...keys }
            for (const id of bumped) copy[id] = (copy[id] ?? 0) + 1
            return copy
          })
        }
      }
      seenShifts.current = new Map(
        next.plots.map((plot) => [plot.volunteerId, plot.completedShifts]),
      )
      setState(next)
    }
    if (digestRes.ok) setDigest((await digestRes.json()) as DigestResponse)
  }, [])

  useEffect(() => {
    // refresh() is async: every setState inside it runs after an awaited fetch,
    // so there is no synchronous cascading render for the rule to prevent. It
    // fires because refresh transitively sets state, not because it does so in
    // this effect's body.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [refresh])

  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 720px)')
    const still = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      setCompact(narrow.matches)
      setReducedMotion(still.matches)
    }
    sync()
    narrow.addEventListener('change', sync)
    still.addEventListener('change', sync)
    return () => {
      narrow.removeEventListener('change', sync)
      still.removeEventListener('change', sync)
    }
  }, [])

  // The recent-activity overlay settles back after a while of no input.
  useEffect(() => {
    let timer = window.setTimeout(() => setFaded(true), FADE_AFTER_MS)
    const wake = () => {
      setFaded(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setFaded(true), FADE_AFTER_MS)
    }
    window.addEventListener('pointerdown', wake)
    window.addEventListener('pointermove', wake)
    window.addEventListener('keydown', wake)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', wake)
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('keydown', wake)
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDigestOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const runAgent = useCallback(async () => {
    setOverlayOpen(false)
    setRunStatus('Running the agent.')
    try {
      const response = await fetch('/api/trigger/loop', { method: 'POST' })
      if (response.status === 404) {
        setRunStatus(
          'The agent loop is not connected yet. Everything else here is live.',
        )
        return
      }
      if (!response.ok) {
        setRunStatus('The agent run failed. Try it again in a moment.')
        return
      }
      const result = (await response.json()) as TriggerResponse
      setRunStatus(result.summary || 'The agent finished its pass.')
      await refresh()
      setDigestOpen(true)
    } catch {
      setRunStatus('The agent could not be reached. Check the server is up.')
    }
  }, [refresh])

  const plots: Plot[] = state?.plots ?? []
  const upcomingShifts = state?.upcomingShifts ?? []
  const selected = plots.find((plot) => plot.volunteerId === selectedId) ?? null
  const nextShift = upcomingShifts[0] ?? null
  const activity = state?.recentActivity.slice(0, 3) ?? []

  return (
    <main className="shell">
      <div className="scene" aria-hidden="true">
        <Block
          plots={plots}
          lightUpKeys={lightUpKeys}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id)
            if (id !== null) setFoodBankSelected(false)
          }}
          compact={compact}
          reducedMotion={reducedMotion}
          upcomingShifts={upcomingShifts}
          foodBankSelected={foodBankSelected}
          onSelectFoodBank={() => {
            setSelectedId(null)
            setFoodBankSelected((value) => !value)
          }}
        />
      </div>

      <header className="header">
        <h1 className="wordmark">The Block</h1>
        <p className="tagline">
          Every light is someone who showed up.
        </p>
        <div className="header-spacer" />
        <button
          type="button"
          className="ghost-button"
          aria-expanded={digestOpen}
          onClick={() => setDigestOpen((value) => !value)}
        >
          Digest
        </button>
      </header>

      <div className="activity" data-faded={faded && !selected && !foodBankSelected}>
        <h2>Recent activity</h2>
        {activity.length > 0 ? (
          <ul>
            {activity.map((item) => (
              <li key={item.eventId}>{item.text}</li>
            ))}
          </ul>
        ) : (
          <p className="note">
            No shifts logged yet. The block fills in as people show up.
          </p>
        )}
        {runStatus ? <p className="note">{runStatus}</p> : null}
        {selected ? (
          <div className="inspect">
            <h3>{selected.name}</h3>
            <p>{describePlot(selected)}</p>
          </div>
        ) : null}
        {foodBankSelected && nextShift ? (
          <div className="inspect">
            <h3>The food bank</h3>
            <p>{describeShift(nextShift)}</p>
          </div>
        ) : null}
      </div>

      <Digest
        digest={digest}
        plots={plots}
        open={digestOpen}
        onClose={() => setDigestOpen(false)}
      />

      {overlayOpen ? (
        <Overlay
          onRunAgent={() => void runAgent()}
          onDismiss={() => setOverlayOpen(false)}
        />
      ) : null}
    </main>
  )
}
