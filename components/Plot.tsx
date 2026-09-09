'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Plot as PlotData } from '@/lib/types'
import {
  PALETTE,
  SLAB,
  jitterFor,
  lampColor,
  lampIntensity,
} from '@/components/scene-utils'

interface PlotProps {
  plot: PlotData
  position: [number, number, number]
  /** Bumps when this plot gained something. Drives the one light-up moment. */
  lightUpKey: number
  reducedMotion: boolean
  selected: boolean
  onSelect: (volunteerId: string) => void
}

const LIGHT_UP_SECONDS = 1.2

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/** Window positions per stage: front face first, then a side. */
/**
 * Windows on all four faces.
 *
 * They used to sit only on +Z and +X, which is why the camera was pinned to a
 * 57 degree arc looking at that corner — swing past it and every building was a
 * blank dark box, and "every light is someone who showed up" disappeared. Four
 * faces is what lets the block be walked around.
 *
 * The back faces get fewer windows than the front, so the building still has an
 * obvious front and the town does not read as symmetrical.
 */
function windowSlots(stage: number, w: number, d: number, h: number) {
  const slots: { pos: [number, number, number]; rotY: number }[] = []
  const front = d / 2 + 0.008
  const back = -d / 2 - 0.008
  const right = w / 2 + 0.008
  const left = -w / 2 - 0.008
  const lower = h * 0.34
  const upper = h * 0.72

  if (stage >= 2) {
    slots.push({ pos: [-w * 0.22, lower, front], rotY: 0 })
    slots.push({ pos: [w * 0.22, lower, front], rotY: 0 })
    slots.push({ pos: [w * 0.05, lower, back], rotY: 0 })
  }
  if (stage >= 3) {
    slots.push({ pos: [right, lower, d * 0.18], rotY: Math.PI / 2 })
    slots.push({ pos: [left, lower, -d * 0.16], rotY: Math.PI / 2 })
  }
  if (stage >= 4) {
    slots.push({ pos: [-w * 0.22, upper, front], rotY: 0 })
    slots.push({ pos: [w * 0.22, upper, front], rotY: 0 })
    slots.push({ pos: [right, upper, -d * 0.18], rotY: Math.PI / 2 })
    slots.push({ pos: [-w * 0.2, upper, back], rotY: 0 })
    slots.push({ pos: [left, upper, d * 0.2], rotY: Math.PI / 2 })
  }
  return slots
}

export default function Plot({
  plot,
  position,
  lightUpKey,
  reducedMotion,
  selected,
  onSelect,
}: PlotProps) {
  const jitter = useMemo(() => jitterFor(plot.volunteerId), [plot.volunteerId])
  const lampHue = useMemo(() => lampColor(plot.quietness), [plot.quietness])
  const glow = lampIntensity(plot.quietness)

  const windowMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        roughness: 1,
        metalness: 0,
        toneMapped: false,
      }),
    [],
  )
  const lampMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        roughness: 1,
        metalness: 0,
        toneMapped: false,
      }),
    [],
  )

  const pointRef = useRef<THREE.PointLight>(null)
  const progress = useRef(1)

  // Colour follows quietness. Never dark, never a stage change.
  useEffect(() => {
    windowMaterial.color.copy(lampHue).multiplyScalar(0.12)
    windowMaterial.emissive.copy(lampHue)
    lampMaterial.color.copy(lampHue).multiplyScalar(0.12)
    lampMaterial.emissive.copy(lampHue)
    windowMaterial.emissiveIntensity = glow * progress.current
    lampMaterial.emissiveIntensity = glow * progress.current
  }, [lampHue, glow, windowMaterial, lampMaterial])

  useEffect(
    () => () => {
      windowMaterial.dispose()
      lampMaterial.dispose()
    },
    [windowMaterial, lampMaterial],
  )

  // The single orchestrated moment: a new event lands, this light comes up.
  useEffect(() => {
    if (lightUpKey === 0) return
    progress.current = reducedMotion ? 1 : 0
  }, [lightUpKey, reducedMotion])

  useFrame((_, delta) => {
    if (progress.current >= 1) return
    progress.current = Math.min(1, progress.current + delta / LIGHT_UP_SECONDS)
    const t = easeOutCubic(progress.current)
    windowMaterial.emissiveIntensity = glow * t
    lampMaterial.emissiveIntensity = glow * t
    if (pointRef.current) pointRef.current.intensity = 1.6 * glow * t
  })

  const lit = plot.completedShifts > 0
  // Sized for the 4-unit lot the asset pack's tiles establish. At the old
  // scale a street lamp from the pack (4.10 tall) stood higher than a finished
  // house and a car (3.06 long) was longer than a house was tall.
  const width = 2.3 * jitter.widthScale
  const depth = 2.3 * jitter.depthScale
  const baseHeight =
    plot.stage >= 4 ? 3.3 : plot.stage === 3 ? 2.4 : plot.stage === 2 ? 1.7 : 0
  const height = baseHeight * jitter.heightScale
  const roofRadius = (Math.max(width, depth) / Math.SQRT2) * 1.1
  const roofHeight = 0.62
  const slabTop = 0.12

  return (
    <group position={position}>
      {selected ? (
        <mesh position={[0, 0.03, 0]} rotation-y={jitter.padRotation}>
          <boxGeometry args={[3.8, 0.05, 3.8]} />
          <meshStandardMaterial color={PALETTE.stone} roughness={1} />
        </mesh>
      ) : null}

      {/* The lot itself. Empty is --stone-dim: neutral, never negative. */}
      <mesh
        position={[0, 0.06, 0]}
        rotation-y={jitter.padRotation}
        onClick={(event) => {
          event.stopPropagation()
          onSelect(plot.volunteerId)
        }}
      >
        <boxGeometry args={[3.5, 0.12, 3.5]} />
        <meshStandardMaterial
          color={plot.stage === 0 ? PALETTE.stoneDim : '#3b4c64'}
          roughness={1}
        />
      </mesh>

      <group
        position={[jitter.offsetX, slabTop, jitter.offsetZ]}
        rotation-y={jitter.rotation}
      >
        {/* Stage 1 foundation. Additive: it stays under everything after. */}
        {plot.stage >= 1 ? (
          <mesh position={[0, 0.11, 0]}>
            <boxGeometry args={[width + 0.3, 0.22, depth + 0.3]} />
            <meshStandardMaterial color={SLAB} roughness={1} />
          </mesh>
        ) : null}

        {plot.stage >= 2 ? (
          <mesh position={[0, 0.22 + height / 2, 0]}>
            <boxGeometry args={[width, height, depth]} />
            <meshStandardMaterial color={PALETTE.stone} roughness={1} flatShading />
          </mesh>
        ) : null}

        {plot.stage >= 3 && jitter.hasAnnex ? (
          <mesh
            position={[
              jitter.annexSide * (width / 2 + 0.3),
              0.22 + height * 0.32,
              depth * 0.12,
            ]}
          >
            <boxGeometry args={[0.62, height * 0.64, depth * 0.72]} />
            <meshStandardMaterial color={PALETTE.stone} roughness={1} flatShading />
          </mesh>
        ) : null}

        {plot.stage >= 3 ? (
          <mesh
            position={[0, 0.22 + height + roofHeight / 2, 0]}
            rotation-y={Math.PI / 4}
          >
            <coneGeometry args={[roofRadius, roofHeight, 4]} />
            <meshStandardMaterial color={PALETTE.brick} roughness={1} flatShading />
          </mesh>
        ) : null}

        {plot.stage >= 3 && jitter.hasChimney ? (
          <mesh position={[width * 0.24, 0.22 + height + 0.42, -depth * 0.2]}>
            <boxGeometry args={[0.17, 0.62, 0.17]} />
            <meshStandardMaterial color={PALETTE.brick} roughness={1} />
          </mesh>
        ) : null}

        {lit
          ? windowSlots(plot.stage, width, depth, height).map((slot, index) => (
              <mesh
                key={index}
                material={windowMaterial}
                position={[slot.pos[0], 0.22 + slot.pos[1], slot.pos[2]]}
                rotation-y={slot.rotY}
              >
                <boxGeometry args={[0.2, 0.26, 0.04]} />
              </mesh>
            ))
          : null}

        {/* Stage 4 alone gets a real light spilling onto the street. */}
        {plot.stage >= 4 ? (
          <pointLight
            ref={pointRef}
            position={[0, 0.22 + height * 0.5, depth * 1.15]}
            color={lampHue}
            intensity={1.6 * glow}
            distance={6}
            decay={2}
          />
        ) : null}

        {plot.hasGarden ? (
          <group position={[-width / 2 - 0.34, 0.22, depth * 0.28]}>
            <mesh position={[0, 0.16, 0]}>
              <coneGeometry args={[0.16, 0.34, 5]} />
              <meshStandardMaterial color={PALETTE.moss} roughness={1} flatShading />
            </mesh>
            <mesh position={[0.26, 0.11, -0.3]}>
              <coneGeometry args={[0.12, 0.24, 5]} />
              <meshStandardMaterial color={PALETTE.moss} roughness={1} flatShading />
            </mesh>
          </group>
        ) : null}
      </group>

      {/* A porch lamp on every plot where someone has actually shown up. */}
      {lit ? (
        <group position={[1.45, slabTop, 1.45]}>
          <mesh position={[0, 0.42, 0]}>
            <cylinderGeometry args={[0.035, 0.05, 0.84, 6]} />
            <meshStandardMaterial color={PALETTE.stoneDim} roughness={1} />
          </mesh>
          <mesh position={[0, 0.92, 0]} material={lampMaterial}>
            <boxGeometry args={[0.17, 0.17, 0.17]} />
          </mesh>
        </group>
      ) : null}
    </group>
  )
}
