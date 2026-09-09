'use client'

import { Suspense, useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { Plot as PlotData, Shift } from '@/lib/types'
import Plot from '@/components/Plot'
import Street from '@/components/Street'
import Props from '@/components/Props'
import Skyline from '@/components/Skyline'
import { preloadSceneAssets } from '@/components/scene-assets'
import FoodBank from '@/components/FoodBank'
import Forecourt from '@/components/Forecourt'
import { PALETTE, layoutPlots } from '@/components/scene-utils'

interface BlockProps {
  plots: PlotData[]
  /** volunteerId -> counter. A change is a light coming up. */
  lightUpKeys: Record<string, number>
  selectedId: string | null
  onSelect: (volunteerId: string | null) => void
  compact: boolean
  reducedMotion: boolean
  /** Upcoming shifts, soonest first. The next one is drawn on the forecourt. */
  upcomingShifts: Shift[]
  foodBankSelected: boolean
  onSelectFoodBank: () => void
}

preloadSceneAssets()

/** Fixed isometric-ish direction. Only the distance ever changes. */
const VIEW_DIR = new THREE.Vector3(0.642, 0.418, 0.642).normalize()

/**
 * Keeps the whole block in frame at any viewport without moving the angle.
 * Mobile gets the same scene, framed tighter.
 */
function Framing({
  width,
  depth,
  centreZ,
  compact,
}: {
  width: number
  /** Full scene extent, grid plus the food bank in front of it. */
  depth: number
  /** Middle of the scene along Z. The food bank sits well off the grid's
   *  centre, so aiming at the grid alone left the composition lopsided. */
  centreZ: number
  compact: boolean
}) {
  const camera = useThree((state) => state.camera)
  const scene = useThree((state) => state.scene)
  const size = useThree((state) => state.size)

  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    const aspect = Math.max(0.3, size.width / Math.max(1, size.height))
    // A portrait viewport turns a 30 degree vertical fov into roughly 14
    // degrees horizontally, so fitting the block's width shoved the camera far
    // enough away that the scene became a stripe in the middle of the screen.
    // Widening the lens on small screens fits the same block from closer in.
    cam.fov = compact ? 58 : 30
    const vFov = (cam.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect)
    const elevation = Math.asin(VIEW_DIR.y)
    // The whole block is always in frame. Cropping to 74% here was cutting
    // buildings in half at the left and right edges, which reads as a bug
    // rather than as design.md section 4's "tighter framing".
    const spanAcross = (width + depth) / Math.SQRT2
    const spanUp =
      ((width + depth) / Math.SQRT2) * Math.sin(elevation) +
      3.4 * Math.cos(elevation)
    // The near corner of the block projects lower than spanUp predicts, so the
    // bottom row clipped at the default margin. Verified against a 1400x708
    // capture with 23 plots.
    // Verified against the edge-sampling check: nothing touches a viewport
    // edge at this margin with the food bank in frame.
    const margin = compact ? 1.1 : 1.34
    const distance = Math.max(
      (spanAcross * margin) / 2 / Math.tan(hFov / 2),
      (spanUp * margin) / 2 / Math.tan(vFov / 2),
    )
    const lookAt = new THREE.Vector3(0, 1, centreZ)
    cam.position.copy(VIEW_DIR).multiplyScalar(distance).add(lookAt)
    cam.lookAt(lookAt)
    cam.updateProjectionMatrix()

    // Fog only ever eats the empty ground past the block, so it reads as sky.
    if (scene.fog instanceof THREE.Fog) {
      // Far enough to leave the skyline as a readable silhouette rather than
      // swallowing it; near enough that it still reads as distance.
      scene.fog.near = distance * 1.05
      scene.fog.far = distance * 3.2
    }
  }, [camera, scene, size.width, size.height, width, depth, centreZ, compact])

  return null
}

export default function Block({
  plots,
  lightUpKeys,
  selectedId,
  onSelect,
  compact,
  reducedMotion,
  upcomingShifts,
  foodBankSelected,
  onSelectFoodBank,
}: BlockProps) {
  const layout = useMemo(() => layoutPlots(plots), [plots])
  const { placements, width, depth, foodBank, sceneDepth } = layout

  // The forecourt shows the next shift, which is the one the agent is about to
  // act on. deriveShifts already returns them soonest first.
  const nextShift = upcomingShifts[0] ?? null

  // Content runs from behind the food bank to the front row of lots. Aim at the
  // middle of that, not at the middle of the housing grid.
  const centreZ = (foodBank.z - 2.2 + depth / 2) / 2

  // Zoom bounds are tied to the block's own size rather than fixed numbers, so
  // they stay sensible whatever the volunteer count does to the layout.
  const span = (width + depth) / Math.SQRT2
  const zoom = { min: span * 0.45, max: span * 2.2 }

  return (
    <Canvas
      flat
      dpr={[1, 2]}
      camera={{ position: [21.5, 14, 21.5], fov: 30 }}
      gl={{ antialias: true }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={[PALETTE.dusk]} />
      <fog attach="fog" args={[PALETTE.dusk, 40, 90]} />

      <Framing
        width={width}
        depth={sceneDepth}
        centreZ={centreZ}
        compact={compact}
      />

      <hemisphereLight args={['#6d81a2', '#1a2534', 0.72]} />
      <ambientLight intensity={0.26} color="#61728c" />
      <directionalLight position={[16, 13, 9]} intensity={1} color="#e6d9c4" />
      <directionalLight
        position={[-14, 7, -8]}
        intensity={0.22}
        color="#57709a"
      />

      <mesh rotation-x={-Math.PI / 2}>
        {/* Large enough that its far edge always falls beyond fog.far — at a
            wide mobile fov a smaller plane showed its horizon as a hard
            silhouette against the sky. */}
        <planeGeometry args={[420, 420]} />
        <meshStandardMaterial color={PALETTE.duskDeep} roughness={1} />
      </mesh>

      {/*
        Everything that loads a GLB goes inside Suspense.

        useGLTF suspends, and a suspending component with no boundary unmounts
        the whole subtree — including <color attach="background"> — which
        renders the canvas plain white with no error to show for it. Lights,
        fog and framing stay outside so the scene has its dusk ground from the
        first frame rather than flashing white while assets arrive.
      */}
      <Suspense fallback={null}>
        <Street layout={layout} />
        <Props layout={layout} />
        <Skyline layout={layout} />
      </Suspense>

      <FoodBank
        position={[foodBank.x, 0, foodBank.z]}
        selected={foodBankSelected}
        onSelect={onSelectFoodBank}
      />
      <Forecourt
        position={[foodBank.x, 0, foodBank.z + 3.4]}
        shift={nextShift}
      />

      {placements.map(({ plot, x, z }) => (
        <Plot
          key={plot.volunteerId}
          plot={plot}
          position={[x, 0, z]}
          lightUpKey={lightUpKeys[plot.volunteerId] ?? 0}
          reducedMotion={reducedMotion}
          selected={selectedId === plot.volunteerId}
          onSelect={onSelect}
        />
      ))}

      {/*
        Walk around the block, but never fly over it.

        Rotation is unrestricted now that plots carry windows on all four faces
        (see windowSlots in Plot.tsx) — the old 57 degree arc existed because the
        back of every building was blank, not because the design called for it.

        Elevation stays clamped and panning stays off, so design.md section 4's
        "fixed isometric-ish angle, no free camera" still holds: you cannot get
        under the ground plane, look straight down, or lose the block offscreen.

        Zoom is bounded rather than disabled. The forecourt figures are the one
        thing a viewer should be able to count, and at the default distance they
        are too small to count.
      */}
      <OrbitControls
        enablePan={false}
        enableZoom
        zoomSpeed={0.6}
        minDistance={zoom.min}
        maxDistance={zoom.max}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.35}
        minPolarAngle={Math.PI / 4.4}
        maxPolarAngle={Math.PI / 3.1}
        target={[0, 1, centreZ]}
      />
    </Canvas>
  )
}
