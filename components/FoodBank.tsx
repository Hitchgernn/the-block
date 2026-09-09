'use client'

import { useRef } from 'react'
import type * as THREE from 'three'
import { KERB, PALETTE, SLAB } from '@/components/scene-utils'
import { Instances, Instance } from '@react-three/drei'
import { TILE, useSceneAsset } from '@/components/scene-assets'

interface FoodBankProps {
  position: [number, number, number]
  selected: boolean
  onSelect: () => void
}

/** Footprint of shop-awning-01, used to place the yard behind it. */
const DEPTH = 6.26
const HEIGHT = 7.65

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

      {/*
        The service yard. A food bank's back is where the deliveries arrive, so
        the rear reads as a loading dock rather than as a blank wall — which is
        what it was before the camera could be rotated all the way around.

        Nothing here glows. --lamp means one thing only, and a delivery bay is
        not somebody showing up for a shift (design.md section 3).
      */}
      <group position={[0, 0, -DEPTH / 2]}>
        {/* Dock platform, at the height a van bed would sit. */}
        <mesh position={[0, 0.26, -0.85]}>
          <boxGeometry args={[4.6, 0.52, 1.7]} />
          <meshStandardMaterial color={SLAB} roughness={1} flatShading />
        </mesh>

        {/* Roller shutter, recessed into the wall. */}
        <mesh position={[-0.5, 0.18 + 0.78, -0.03]}>
          <boxGeometry args={[2.7, 1.45, 0.08]} />
          <meshStandardMaterial color="#3a4759" roughness={1} flatShading />
        </mesh>
        {[0.28, 0.6, 0.92, 1.24].map((y) => (
          <mesh key={y} position={[-0.5, 0.18 + y, -0.09]}>
            <boxGeometry args={[2.62, 0.05, 0.03]} />
            <meshStandardMaterial color={KERB} roughness={1} />
          </mesh>
        ))}

        {/* Staff door beside the shutter. */}
        <mesh position={[1.6, 0.18 + 0.55, -0.03]}>
          <boxGeometry args={[0.72, 1.1, 0.08]} />
          <meshStandardMaterial color="#33405a" roughness={1} flatShading />
        </mesh>

        {/* Stacked crates waiting to go in. */}
        {[
          { pos: [-1.5, 0.72, -0.95] as const, size: [0.62, 0.4, 0.5] as const },
          { pos: [-1.44, 1.1, -0.9] as const, size: [0.54, 0.36, 0.44] as const },
          { pos: [-0.72, 0.68, -1.15] as const, size: [0.5, 0.32, 0.44] as const },
          { pos: [1.35, 0.7, -1.05] as const, size: [0.58, 0.36, 0.48] as const },
        ].map((crate, index) => (
          <mesh key={index} position={crate.pos} rotation-y={index * 0.18 - 0.2}>
            <boxGeometry args={crate.size} />
            <meshStandardMaterial color={SLAB} roughness={1} flatShading />
          </mesh>
        ))}

        {/* Bins at the edge of the yard. */}
        {[-2.75, -2.1].map((x) => (
          <mesh key={x} position={[x, 0.34, -1.5]}>
            <cylinderGeometry args={[0.26, 0.23, 0.68, 8]} />
            <meshStandardMaterial color={KERB} roughness={1} flatShading />
          </mesh>
        ))}
      </group>

      {/* Roof plant — gives the flat roof a silhouette from every angle. */}
      <mesh position={[-1.5, 0.18 + HEIGHT + 0.42, -0.5]}>
        <boxGeometry args={[1.5, 0.42, 1.05]} />
        <meshStandardMaterial color={KERB} roughness={1} flatShading />
      </mesh>
      <mesh position={[1.5, 0.18 + HEIGHT + 0.36, -0.35]}>
        <cylinderGeometry args={[0.3, 0.3, 0.3, 10]} />
        <meshStandardMaterial color={KERB} roughness={1} flatShading />
      </mesh>

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
