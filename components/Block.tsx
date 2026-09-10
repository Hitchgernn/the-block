'use client'

import { useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { Plot as PlotData } from '@/lib/types'
import Plot from '@/components/Plot'
import Street from '@/components/Street'
import Props from '@/components/Props'
import Skyline from '@/components/Skyline'
import { TILE, preloadSceneAssets } from '@/components/scene-assets'
import FoodBank from '@/components/FoodBank'
import SceneLayer from '@/components/SceneLayer'
import { GROUND_PLANE_Y, KERB, PALETTE, layoutPlots } from '@/components/scene-utils'

interface BlockProps {
  plots: PlotData[]
  /** volunteerId -> counter. A change is a light coming up. */
  lightUpKeys: Record<string, number>
  selectedId: string | null
  onSelect: (volunteerId: string | null) => void
  compact: boolean
  reducedMotion: boolean
  /** Upcoming shifts, soonest first. The next one is drawn on the forecourt. */
  foodBankSelected: boolean
  onSelectFoodBank: () => void
}

preloadSceneAssets()

const PLINTH_HEIGHT = 1.6
/** Darker than the ground it stands on, so the edge reads without a highlight. */
const PLINTH_SIDE = '#16202e'

/**
 * How far the camera may tilt, measured from straight down. OrbitControls
 * clamps to these every frame, so the opening angle has to be one of them
 * rather than a separate number that happens to look right.
 *
 * It was not: the opening direction worked out to a 65.3 degree polar angle
 * against a 58.06 degree ceiling, so the controls hauled the camera up on the
 * first frame and the framing below sized the distance for an elevation
 * nobody ever saw.
 */
const POLAR_MIN = Math.PI / 4.4
const POLAR_MAX = Math.PI / 3.1
/** A little above the low end, which is the isometric-ish angle design.md asks for. */
const POLAR_DEFAULT = POLAR_MAX - 0.04

/** Fixed isometric-ish direction. Only the distance ever changes. */
const VIEW_DIR = new THREE.Vector3(
  Math.sin(POLAR_DEFAULT) * Math.SQRT1_2,
  Math.cos(POLAR_DEFAULT),
  Math.sin(POLAR_DEFAULT) * Math.SQRT1_2,
).normalize()

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
    // Framed a touch wide so the plinth's edge stays in shot — the thickness
    // is the whole point of having one.
    //
    // Across and up carry their own margins because the two fits are not the
    // same problem. The block is widest along its diagonal and the sides need
    // room; vertically it is already stretched by the camera's tilt, and one
    // shared 1.42 pushed the camera far enough back that the skyline came over
    // the top edge and the town shrank into the middle of the frame. 1.18 puts
    // the vertical fit back level with the horizontal one at 1400x708.
    const marginAcross = compact ? 1.3 : 1.42
    const marginUp = compact ? 1.12 : 1.18
    const distance = Math.max(
      (spanAcross * marginAcross) / 2 / Math.tan(hFov / 2),
      (spanUp * marginUp) / 2 / Math.tan(vFov / 2),
    )
    const lookAt = new THREE.Vector3(0, 1, centreZ)
    cam.position.copy(VIEW_DIR).multiplyScalar(distance).add(lookAt)
    cam.lookAt(lookAt)
    cam.updateProjectionMatrix()

    // A handle for scripts/audit-scene.mjs, which walks the real scene graph
    // rather than re-deriving the layout — a second copy of the maths is what
    // caused most of the bugs it looks for.
    ;(window as unknown as { __blockScene?: THREE.Scene }).__blockScene = scene

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
  foodBankSelected,
  onSelectFoodBank,
}: BlockProps) {
  const layout = useMemo(() => layoutPlots(plots), [plots])
  const { placements, foodBank, sceneDepth } = layout


  // Content runs from behind the food bank to the front row of lots. Aim at the
  // middle of that, not at the middle of the housing grid.
  const centreZ = (foodBank.z - 2.2 + layout.depth / 2) / 2

  // Zoom bounds are tied to the block's own size rather than fixed numbers, so
  // they stay sensible whatever the volunteer count does to the layout.
  // Sized to hold the block, its streets and the grass rim around them.
  // Sized from the same ground extent the grass ring is laid to, plus one tile
  // of margin, so the slab always reaches past the last turf rather than
  // stopping short and letting the ground plane show through underneath.
  const ground = layout.ground
  const plinth = {
    width: (ground.halfX + TILE * 2) * 2,
    depth: ground.nearZ - ground.farZ + TILE * 4,
    centre: (ground.nearZ + ground.farZ) / 2,
  }

  const span = (layout.width + layout.depth) / Math.SQRT2
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
        width={layout.width}
        depth={sceneDepth}
        centreZ={centreZ}
        compact={compact}
      />

      <hemisphereLight args={['#6d81a2', '#1a2534', 0.72]} />
      <ambientLight intensity={0.34} color="#61728c" />
      <directionalLight position={[16, 13, 9]} intensity={1} color="#e6d9c4" />
      {/*
        Fill from the side the key light does not reach. Now that the camera can
        be walked all the way round, the far faces were falling close to black
        and the town read as unlit from behind — which quietly undermines "every
        light is someone who showed up". Cool and low, so it lifts the silhouette
        without competing with a window.
      */}
      <directionalLight
        position={[-14, 7, -8]}
        intensity={0.46}
        color="#5b74a0"
      />

      {/* Dropped below the plinth's top face. Both sat at y=0 and fought for
          the same depth, which striped the slab with banding. */}
      <mesh name="ground-plane" rotation-x={-Math.PI / 2} position={[0, GROUND_PLANE_Y, 0]}>
        {/* Large enough that its far edge always falls beyond fog.far — at a
            wide mobile fov a smaller plane showed its horizon as a hard
            silhouette against the sky. */}
        <planeGeometry args={[420, 420]} />
        <meshStandardMaterial color={PALETTE.duskDeep} roughness={1} />
      </mesh>

      {/*
        The block stands on a plinth with visible thickness rather than lying
        flat on the ground plane. Every one of the reference images does this —
        it is what makes a low-poly scene read as a made object instead of tiles
        floating on nothing, and it gives the streets somewhere to stop.

        The skyline stays out on the ground plane beyond it, so the town sits on
        raised ground with the city below and behind — the composition in
        reference-1 and reference-3.
      */}
      <group name="plinth" position={[0, 0, plinth.centre]}>
        <mesh position={[0, -PLINTH_HEIGHT / 2, 0]}>
          <boxGeometry
            args={[plinth.width, PLINTH_HEIGHT, plinth.depth]}
          />
          <meshStandardMaterial color={PLINTH_SIDE} roughness={1} flatShading />
        </mesh>
        {/* A narrow lip catches the key light and reads as a kerb edge. It sits
            wholly below the plinth's top face: as a full-footprint box with its
            own top also at y=0 it fought the slab for the same depth and striped
            the whole surface with banding. */}
        <mesh position={[0, -0.19, 0]}>
          <boxGeometry
            args={[plinth.width + 0.5, 0.12, plinth.depth + 0.5]}
          />
          <meshStandardMaterial color={KERB} roughness={1} flatShading />
        </mesh>
      </group>

      {/*
        Every layer that loads a GLB gets its own boundary. useGLTF suspends,
        and a suspending component with no boundary above it unmounts the whole
        subtree — including <color attach="background"> — which renders the
        canvas plain white and throws no error to explain itself. Lights, fog
        and framing stay outside so the scene has its dusk ground from the first
        frame.

        One boundary per layer rather than one for all of them: shared, the
        streets waited on the skyline's Draco decode and looked like they had
        failed to render. See components/SceneLayer.tsx.
      */}
      <SceneLayer name="street">
        <Street layout={layout} />
      </SceneLayer>
      <SceneLayer name="street furniture">
        <Props layout={layout} />
      </SceneLayer>
      <SceneLayer name="skyline">
        <Skyline layout={layout} />
      </SceneLayer>
      <SceneLayer name="food bank">
        <FoodBank
          position={[foodBank.x, 0, foodBank.z]}
          selected={foodBankSelected}
          onSelect={onSelectFoodBank}
        />
      </SceneLayer>


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
        minPolarAngle={POLAR_MIN}
        maxPolarAngle={POLAR_MAX}
        target={[0, 1, centreZ]}
      />
    </Canvas>
  )
}
