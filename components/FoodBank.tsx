'use client'

import { useRef } from 'react'
import type * as THREE from 'three'
import { PALETTE } from '@/components/scene-utils'
import { Instances, Instance } from '@react-three/drei'
import { TILE, useSceneAsset } from '@/components/scene-assets'

interface FoodBankProps {
  position: [number, number, number]
  selected: boolean
  onSelect: () => void
}

/**
 * Depth of shop-awning-01, used to place the doorway light.
 *
 * The hand-built service yard that used to stand behind this — loading dock,
 * crates, bins, roof plant — was built when the food bank was a plain box. The
 * pack's shop arrives with its own back: fire escape, service door and steps,
 * vents, downpipes, a water tower. The hand-built version was clashing through
 * the building's own steps, so it is gone. Two things drawing the same wall is
 * the same mistake as two functions computing the same number.
 */
const DEPTH = 6.26

/** Single-instance scenery, so it renders as a plain mesh rather than a batch. */
function Shell() {
  const loaded = useSceneAsset('shopAwning')
  if (!loaded) return null
  return <mesh geometry={loaded.geometry} material={loaded.material} />
}

function Paving({ selected }: { selected: boolean }) {
  const loaded = useSceneAsset('plazaPaving')
  if (!loaded) return null
  return (
    <Instances
      geometry={loaded.geometry}
      material={loaded.material}
      limit={9}
      frustumCulled={false}
    >
      {[-TILE, 0, TILE].map((x) =>
        [TILE * 0.75, TILE * 1.75].map((z) => (
          <Instance key={`${x}-${z}`} position={[x, selected ? 0.02 : 0, z]} />
        )),
      )}
    </Instances>
  )
}

/**
 * The one building on the block that is not somebody's plot.
 *
 * Every event in the log is about this place, and without it a viewer sees a
 * street of houses and has to be told what the town is for. It is deliberately
 * unlike a plot — wider, flat-roofed where the houses get a --brick cone, with
 * a canopy over the door — so it never reads as a volunteer who has somehow
 * grown larger than everyone else.
 *
 * The light over its door is --lamp, which is allowed: this is the doorway
 * people actually show up to.
 */
export default function FoodBank({ position, selected, onSelect }: FoodBankProps) {
  const lightRef = useRef<THREE.PointLight>(null)

  return (
    <group position={position}>
      {/* Paved forecourt, so the building stands on ground of its own and the
          figures waiting for the next shift have somewhere to wait. */}
      <group
        onClick={(event) => {
          event.stopPropagation()
          onSelect()
        }}
      >
        <Paving selected={selected} />
      </group>

      {/* The shop from the pack stands in for the hand-built box, parapet and
          canopy. It is scenery: the food bank is the one building here nobody
          earned, so it carries no growth stage and no derived state. */}
      <Shell />

      {/* Doorway and windows. */}
      <mesh position={[0, 0.18 + 0.55, DEPTH / 2 + 0.02]}>
        <boxGeometry args={[1.5, 1.1, 0.06]} />
        <meshStandardMaterial
          color="#2c3a4e"
          emissive={PALETTE.lampSoft}
          emissiveIntensity={0.5}
          roughness={1}
          toneMapped={false}
        />
      </mesh>
      {[-2.1, -1.35, 1.35, 2.1].map((x) => (
        <mesh key={x} position={[x, 0.18 + 1.3, DEPTH / 2 + 0.02]}>
          <boxGeometry args={[0.42, 0.5, 0.06]} />
          <meshStandardMaterial
            color="#2c3a4e"
            emissive={PALETTE.lamp}
            emissiveIntensity={0.62}
            roughness={1}
            toneMapped={false}
          />
        </mesh>
      ))}

      <pointLight
        ref={lightRef}
        position={[0, 2.2, DEPTH / 2 + 0.4]}
        color={PALETTE.lamp}
        intensity={1.15}
        distance={8}
        decay={2}
      />
    </group>
  )
}
