'use client'

import { SURFACE_TOP } from '@/components/scene-assets'
import { LOT, PALETTE, SLAB } from '@/components/scene-utils'

/**
 * A lot the grid lays out that nobody has yet.
 *
 * The block is a rectangle and the headcount rarely fills it — twenty-three
 * volunteers in twenty-four cells — so one lot had streets laid around it and
 * nothing drawn on it at all, a hole in the middle of the town.
 *
 * It gets the same treatment as a volunteer who has joined and not yet come:
 * --stone-dim ground with a surveyed edge, never darker or redder. design.md
 * section 7 — an empty lot is an invitation, and inaction is never a visual
 * penalty. It carries no state because there is no volunteer to derive any
 * from; it is ground, and it says so.
 */
export default function VacantLot({ position }: { position: [number, number, number] }) {
  const top = SURFACE_TOP.sidewalk

  return (
    <group name="vacant-lot" position={position}>
      <mesh position={[0, top / 2, 0]}>
        <boxGeometry args={[LOT, top, LOT]} />
        <meshStandardMaterial color={PALETTE.stoneDim} roughness={1} />
      </mesh>
      <group position={[0, top + 0.01, 0]}>
        {([[0, 1], [0, -1], [1, 0], [-1, 0]] as const).map(([ax, az]) => (
          <mesh key={`${ax}${az}`} position={[ax * 1.72, 0, az * 1.72]}>
            <boxGeometry args={[ax === 0 ? 3.5 : 0.09, 0.05, az === 0 ? 3.5 : 0.09]} />
            <meshStandardMaterial color={SLAB} roughness={1} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
