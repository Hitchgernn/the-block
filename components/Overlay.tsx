'use client'

import { useEffect, useRef } from 'react'

interface OverlayProps {
  onRunAgent: () => void
  onDismiss: () => void
}

/**
 * docs/design.md section 5. Orientation, not a landing page: one screen,
 * three sentences, and the live Block already running behind it.
 */
export default function Overlay({ onRunAgent, onDismiss }: OverlayProps) {
  const primaryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    primaryRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="overlay-title"
    >
      <div className="overlay-card">
        <h1 id="overlay-title">The Block</h1>
        <p>
          A food bank&rsquo;s volunteer activity, kept by an agent. Every light
          is someone who showed up. Run the agent and it reads the coverage
          gaps, then picks who to ask.
        </p>
        <div className="overlay-actions">
          <button
            ref={primaryRef}
            type="button"
            className="button-solid"
            onClick={onRunAgent}
          >
            Run the agent
          </button>
          <button type="button" className="button-outline" onClick={onDismiss}>
            Look around
          </button>
        </div>
      </div>
    </div>
  )
}
