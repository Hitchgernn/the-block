'use client'

import { useRef } from 'react'
import type * as THREE from 'three'
import { KERB, PALETTE, SLAB } from '@/components/scene-utils'

interface FoodBankProps {
  position: [number, number, number]
  selected: boolean
  onSelect: () => void
}

const WIDTH = 6.2
const DEPTH = 3.2
const HEIGHT = 2.1

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
      {/* Forecourt slab, so the building sits on ground of its own. */}
      <mesh
        position={[0, 0.03, 1.9]}
        rotation-x={-Math.PI / 2}
        onClick={(event) => {
          event.stopPropagation()
          onSelect()
        }}
      >
        <planeGeometry args={[WIDTH + 1.6, 4.2]} />
        <meshStandardMaterial color={selected ? SLAB : '#33435c'} roughness={1} />
      </mesh>

      <mesh position={[0, 0.09, 0]}>
        <boxGeometry args={[WIDTH + 0.5, 0.18, DEPTH + 0.5]} />
        <meshStandardMaterial color={SLAB} roughness={1} />
      </mesh>

      <mesh position={[0, 0.18 + HEIGHT / 2, 0]}>
        <boxGeometry args={[WIDTH, HEIGHT, DEPTH]} />
        <meshStandardMaterial color={PALETTE.stone} roughness={1} flatShading />
      </mesh>

      {/* A low parapet instead of a pitched roof — civic, not domestic. */}
      <mesh position={[0, 0.18 + HEIGHT + 0.11, 0]}>
        <boxGeometry args={[WIDTH + 0.34, 0.22, DEPTH + 0.34]} />
        <meshStandardMaterial color={KERB} roughness={1} flatShading />
      </mesh>

      {/* Loading canopy over the entrance, facing the block. */}
      <mesh position={[0, 0.18 + 1.42, DEPTH / 2 + 0.6]}>
        <boxGeometry args={[3.4, 0.12, 1.3]} />
        <meshStandardMaterial color={KERB} roughness={1} flatShading />
      </mesh>
      {[-1.5, 1.5].map((x) => (
        <mesh key={x} position={[x, 0.18 + 0.71, DEPTH / 2 + 1.15]}>
          <cylinderGeometry args={[0.06, 0.06, 1.42, 6]} />
          <meshStandardMaterial color={KERB} roughness={1} />
        </mesh>
      ))}

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
        position={[0, 0.18 + 1.5, DEPTH / 2 + 1.1]}
        color={PALETTE.lamp}
        intensity={1.5}
        distance={7}
        decay={2}
      />
    </group>
  )
}
