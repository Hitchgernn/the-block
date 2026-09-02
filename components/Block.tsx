'use client'

import { useEffect, useMemo } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { Plot as PlotData } from '@/lib/types'
import Plot from '@/components/Plot'
import { PALETTE, ROAD, layoutPlots, roadLines } from '@/components/scene-utils'

interface BlockProps {
  plots: PlotData[]
  /** volunteerId -> counter. A change is a light coming up. */
  lightUpKeys: Record<string, number>
  selectedId: string | null
  onSelect: (volunteerId: string | null) => void
  compact: boolean
  reducedMotion: boolean
}

/** Fixed isometric-ish direction. Only the distance ever changes. */
const VIEW_DIR = new THREE.Vector3(0.642, 0.418, 0.642).normalize()
const LOOK_AT = new THREE.Vector3(0, 1, 0)

/**
 * Keeps the whole block in frame at any viewport without moving the angle.
 * Mobile gets the same scene, framed tighter.
 */
function Framing({
  width,
  depth,
  compact,
}: {
  width: number
  depth: number
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
    cam.fov = compact ? 46 : 30
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
    const margin = compact ? 1.06 : 1.34
    const distance = Math.max(
      (spanAcross * margin) / 2 / Math.tan(hFov / 2),
      (spanUp * margin) / 2 / Math.tan(vFov / 2),
    )
    cam.position.copy(VIEW_DIR).multiplyScalar(distance).add(LOOK_AT)
    cam.lookAt(LOOK_AT)
    cam.updateProjectionMatrix()

    // Fog only ever eats the empty ground past the block, so it reads as sky.
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = distance * 1.35
      scene.fog.far = distance * 2.45
    }
  }, [camera, scene, size.width, size.height, width, depth, compact])

  return null
}

export default function Block({
  plots,
  lightUpKeys,
  selectedId,
  onSelect,
  compact,
  reducedMotion,
}: BlockProps) {
  const { placements, width, depth } = useMemo(
    () => layoutPlots(plots),
    [plots],
  )
  const road = useMemo(() => roadLines(width, depth), [width, depth])

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

      <Framing width={width} depth={depth} compact={compact} />

      <hemisphereLight args={['#6d81a2', '#1a2534', 0.72]} />
      <ambientLight intensity={0.26} color="#61728c" />
      <directionalLight position={[16, 13, 9]} intensity={1} color="#e6d9c4" />
      <directionalLight
        position={[-14, 7, -8]}
        intensity={0.22}
        color="#57709a"
      />

      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[160, 160]} />
        <meshStandardMaterial color={PALETTE.duskDeep} roughness={1} />
      </mesh>

      <mesh rotation-x={-Math.PI / 2} position={[road.x, 0.015, 0]}>
        <planeGeometry args={[1.3, depth + 14]} />
        <meshStandardMaterial color={ROAD} roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.015, road.z]}>
        <planeGeometry args={[width + 14, 1.3]} />
        <meshStandardMaterial color={ROAD} roughness={1} />
      </mesh>

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

      {/* Gentle orbit on drag, never a free camera. Off on small screens
          because that drag gesture belongs to the page. */}
      <OrbitControls
        enabled={!compact}
        enablePan={false}
        enableZoom={false}
        enableDamping
        dampingFactor={0.08}
        rotateSpeed={0.35}
        minPolarAngle={Math.PI / 4.4}
        maxPolarAngle={Math.PI / 3.1}
        minAzimuthAngle={Math.PI / 4 - 0.5}
        maxAzimuthAngle={Math.PI / 4 + 0.5}
        target={[0, 1, 0]}
      />
    </Canvas>
  )
}
