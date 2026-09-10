'use client'

import { Component, Suspense } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

/**
 * One layer of borrowed scenery, isolated from the others.
 *
 * Two things used to be shared across the whole environment and should not
 * have been.
 *
 * **Suspense.** Every GLB layer sat behind one boundary, so React showed none
 * of them until the last asset resolved. preloadSceneAssets fires all twenty
 * at once and the skyline towers are by far the heaviest — apartment-block-01
 * is about 69k vertices through a Draco decode — so the road and pavement
 * tiles, decoded long before, stayed invisible while a tower finished. That is
 * the "sometimes the roads don't render" report: they always rendered, just
 * later than everything around them.
 *
 * **Failure.** There was no error boundary at all, so one asset that failed to
 * fetch or parse took the entire environment down silently and permanently.
 *
 * A layer of its own for each means the streets appear as soon as the street
 * tiles are in, and a bad asset costs one layer rather than the town.
 */
class LayerBoundary extends Component<
  { name: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Loud in the console, silent on screen. A judge should see a town missing
    // its benches, never a stack trace over the scene.
    console.error(`[scene] the ${this.props.name} layer failed to load`, error, info)
  }

  render() {
    if (this.state.failed) return null
    return this.props.children
  }
}

export default function SceneLayer({
  name,
  children,
}: {
  name: string
  children: ReactNode
}) {
  return (
    <LayerBoundary name={name}>
      <Suspense fallback={null}>{children}</Suspense>
    </LayerBoundary>
  )
}
