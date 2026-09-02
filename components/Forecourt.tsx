'use client'

import { PALETTE } from '@/components/scene-utils'
import type { Shift } from '@/lib/types'

interface ForecourtProps {
  position: [number, number, number]
  /** The soonest upcoming shift. Null when nothing is scheduled. */
  shift: Shift | null
}

const SPACING = 0.62
const FIGURE_HEIGHT = 0.34

/**
 * Who is coming to the next shift, drawn rather than described.
 *
 * One figure per volunteer already committed, one flat marker per person still
 * needed. "Saturday 9am is short two people" becomes something a viewer counts
 * off the screen without reading a word.
 *
 * Both numbers come from `deriveShifts` in lib/db/derive.ts by way of
 * StateResponse, so this cannot disagree with the digest or the event log.
 *
 * The gap markers are --stone-dim and flat on the ground: a missing volunteer
 * is drawn as an empty place, never as a warning. design.md section 7 —
 * inaction is never a visual penalty.
 */
export default function Forecourt({ position, shift }: ForecourtProps) {
  if (!shift) return null

  const committed = Math.max(0, Math.min(shift.committed, 12))
  const missing = Math.max(0, Math.min(shift.short, 12))
  const total = committed + missing
  if (total === 0) return null

  const start = -((total - 1) * SPACING) / 2

  return (
    <group position={position}>
      {Array.from({ length: total }, (_, index) => {
        const x = start + index * SPACING
        const present = index < committed

        if (!present) {
          // A cylinder's axis is already Y, so this lies flat as a disc on the
          // ground. Rotating it would stand it on edge like a coin.
          return (
            <mesh key={index} position={[x, 0.05, 0]}>
              <cylinderGeometry args={[0.17, 0.17, 0.04, 14]} />
              <meshStandardMaterial
                color={PALETTE.stoneDim}
                roughness={1}
                flatShading
              />
            </mesh>
          )
        }

        // Built from cylinders and a box: design.md section 4 lists box,
        // cylinder, cone and plane, and no sphere.
        return (
          <group key={index} position={[x, 0, 0]}>
            <mesh position={[0, FIGURE_HEIGHT / 2, 0]}>
              <cylinderGeometry args={[0.085, 0.11, FIGURE_HEIGHT, 8]} />
              <meshStandardMaterial
                color={PALETTE.stone}
                roughness={1}
                flatShading
              />
            </mesh>
            <mesh position={[0, FIGURE_HEIGHT + 0.055, 0]}>
              <boxGeometry args={[0.19, 0.06, 0.14]} />
              <meshStandardMaterial
                color={PALETTE.stone}
                roughness={1}
                flatShading
              />
            </mesh>
            <mesh position={[0, FIGURE_HEIGHT + 0.15, 0]}>
              <cylinderGeometry args={[0.062, 0.062, 0.13, 8]} />
              <meshStandardMaterial
                color={PALETTE.stone}
                roughness={1}
                flatShading
              />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}
