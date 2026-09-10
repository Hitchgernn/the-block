'use client'

import { useRef } from 'react'
import type * as THREE from 'three'
import { PALETTE, SLAB } from '@/components/scene-utils'
import { Instances, Instance } from '@react-three/drei'
import { SURFACE_TOP, TILE, useSceneAsset } from '@/components/scene-assets'

interface FoodBankProps {
  position: [number, number, number]
  selected: boolean
  onSelect: () => void
}

/**
 * The building stands on its own paving, whose top face is at SURFACE_TOP.plaza.
 */
const GROUND = SURFACE_TOP.plaza

const WIDTH = 6.4
const DEPTH = 6.26
const HEIGHT = 3.5

/** Single-instance scenery, so it renders as a plain mesh rather than a batch. */
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
 * unlike a plot — wider, flat-roofed behind a parapet where the houses get a
 * --brick cone, with a canopy over the door — so it never reads as a volunteer
 * who has somehow grown larger than everyone else.
 *
 * It was briefly the pack's shop-awning model, which brought a striped awning,
 * a barber pole and a rooftop water tower with it and read as a corner store
 * rather than a place a queue forms outside. Built from primitives it can be
 * exactly the shape the story needs, and it costs six draw calls.
 *
 * The light over its door is --lamp, which is allowed: this is the doorway
 * people actually show up to.
 */
export default function FoodBank({ position, selected, onSelect }: FoodBankProps) {
  const lightRef = useRef<THREE.PointLight>(null)

  const front = DEPTH / 2
  const doorHeight = 1.5
  const canopyY = GROUND + doorHeight + 0.5

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

      <group
        onClick={(event) => {
          event.stopPropagation()
          onSelect()
        }}
      >
        {/* The hall. One long mass, wider than it is tall, which is what makes
            it read as somewhere a queue forms rather than somewhere a family
            lives. */}
        <mesh position={[0, GROUND + HEIGHT / 2, 0]}>
          <boxGeometry args={[WIDTH, HEIGHT, DEPTH]} />
          <meshStandardMaterial color={PALETTE.stone} roughness={1} flatShading />
        </mesh>

        {/* A parapet rather than eaves. The houses are finished with a cone of
            --brick, so a flat top behind a lip is the clearest way to say this
            is not one of them. */}
        <mesh position={[0, GROUND + HEIGHT + 0.17, 0]}>
          <boxGeometry args={[WIDTH + 0.34, 0.34, DEPTH + 0.34]} />
          <meshStandardMaterial color={SLAB} roughness={1} flatShading />
        </mesh>

        {/* Canopy over the door, on two posts. Somewhere to stand out of the
            weather is what the front of this kind of building always has. */}
        <mesh position={[0, canopyY, front + 0.62]}>
          <boxGeometry args={[3.9, 0.16, 1.5]} />
          <meshStandardMaterial color={SLAB} roughness={1} flatShading />
        </mesh>
        {[-1.75, 1.75].map((x) => (
          <mesh
            key={x}
            position={[x, GROUND + (canopyY - GROUND) / 2, front + 1.22]}
          >
            <boxGeometry args={[0.12, canopyY - GROUND, 0.12]} />
            <meshStandardMaterial color={SLAB} roughness={1} />
          </mesh>
        ))}
      </group>

      {/* Doorway. */}
      <mesh position={[0, GROUND + doorHeight / 2, front + 0.02]}>
        <boxGeometry args={[1.6, doorHeight, 0.06]} />
        <meshStandardMaterial
          color="#2c3a4e"
          emissive={PALETTE.lampSoft}
          emissiveIntensity={0.5}
          roughness={1}
          toneMapped={false}
        />
      </mesh>

      {/* Windows either side of the door, and a row above the canopy. */}
      {[-2.3, -1.5, 1.5, 2.3].map((x) => (
        <mesh key={`low-${x}`} position={[x, GROUND + 0.95, front + 0.02]}>
          <boxGeometry args={[0.5, 0.9, 0.06]} />
          <meshStandardMaterial
            color="#2c3a4e"
            emissive={PALETTE.lamp}
            emissiveIntensity={0.62}
            roughness={1}
            toneMapped={false}
          />
        </mesh>
      ))}
      {[-2.1, -0.7, 0.7, 2.1].map((x) => (
        <mesh key={`high-${x}`} position={[x, GROUND + 2.65, front + 0.02]}>
          <boxGeometry args={[0.62, 0.52, 0.06]} />
          <meshStandardMaterial
            color="#2c3a4e"
            emissive={PALETTE.lamp}
            emissiveIntensity={0.45}
            roughness={1}
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* The back. The camera goes all the way round, so the rear cannot be a
          blank wall — but it is a service yard, not a second frontage, and it
          stays unlit: nobody shows up here. */}
      <mesh position={[0, GROUND + 1.05, -front - 0.02]}>
        <boxGeometry args={[1.3, 2.1, 0.06]} />
        <meshStandardMaterial color="#2c3a4e" roughness={1} />
      </mesh>
      <mesh position={[0, GROUND + 0.16, -front - 0.5]}>
        <boxGeometry args={[2.4, 0.32, 1.0]} />
        <meshStandardMaterial color={SLAB} roughness={1} flatShading />
      </mesh>
      {[-2.2, 2.0].map((x) => (
        <mesh key={`vent-${x}`} position={[x, GROUND + HEIGHT + 0.5, -1.4]}>
          <boxGeometry args={[0.7, 0.62, 0.9]} />
          <meshStandardMaterial color={SLAB} roughness={1} flatShading />
        </mesh>
      ))}

      <pointLight
        ref={lightRef}
        position={[0, GROUND + 2.2, front + 0.9]}
        color={PALETTE.lamp}
        intensity={1.15}
        distance={8}
        decay={2}
      />
    </group>
  )
}
