'use client'

import { Instance, Instances } from '@react-three/drei'
import type { AssetName } from '@/components/scene-assets'
import { useSceneAsset } from '@/components/scene-assets'
import type { BlockLayout } from '@/components/scene-utils'
import { jitterFor } from '@/components/scene-utils'

interface SkylineProps {
  layout: BlockLayout
}

interface Tower {
  key: string
  pos: [number, number, number]
  rotY: number
  scale: number
}

function Towers({ asset, towers }: { asset: AssetName; towers: Tower[] }) {
  const loaded = useSceneAsset(asset)
  if (!loaded || towers.length === 0) return null

  return (
    <Instances
      geometry={loaded.geometry}
      material={loaded.material}
      limit={Math.max(1, towers.length)}
      frustumCulled={false}
    >
      {towers.map((t) => (
        <Instance key={t.key} position={t.pos} rotation-y={t.rotY} scale={t.scale} />
      ))}
    </Instances>
  )
}

/**
 * A city on the horizon, so the block is somewhere rather than nowhere.
 *
 * These are the only buildings in the scene that no volunteer earned, which
 * makes them the one thing that could break the rule everything else rests on:
 * if the scene shows a building, an event caused it. Two things keep them
 * honest — they sit far outside the block, well past any lot, and they carry
 * **no lit windows at all**. A glowing window out here would be --lamp saying
 * something it has no right to say (design.md section 3).
 *
 * Dark silhouettes, deep in fog. The composition is reference-1 and
 * reference-3: a small place with a city behind it.
 */
export default function Skyline({ layout }: SkylineProps) {
  const { width, depth } = layout
  const radius = Math.max(width, depth) * 1.4

  const apartments: Tower[] = []
  const skyscrapers: Tower[] = []
  const supertalls: Tower[] = []

  // Ringed around the block, thinned towards the front so the city sits behind
  // the town rather than surrounding it.
  const count = 26
  for (let i = 0; i < count; i += 1) {
    const seed = jitterFor(`sky-${i}`)
    const angle = (i / count) * Math.PI * 2
    // Front of the scene (towards the camera's default corner) stays open.
    const facing = Math.cos(angle - Math.PI / 4)
    // Leave the near corner open so nothing stands between the camera's
    // default position and the block itself.
    if (facing > 0.45) continue

    const distance = radius * (1 + seed.heightScale * 0.35) + Math.abs(seed.offsetX) * 4
    const pos: [number, number, number] = [
      Math.cos(angle) * distance,
      0,
      Math.sin(angle) * distance,
    ]
    const tower: Tower = {
      key: `sky-${i}`,
      pos,
      rotY: seed.rotation * 8,
      scale: 0.7 + seed.heightScale * 0.4,
    }

    const pick = Math.floor(Math.abs(seed.offsetZ) * 997) % 3
    if (pick === 0) apartments.push(tower)
    else if (pick === 1) skyscrapers.push(tower)
    else supertalls.push(tower)
  }

  return (
    <group>
      <Towers asset="apartment" towers={apartments} />
      <Towers asset="skyscraper" towers={skyscrapers} />
      <Towers asset="supertall" towers={supertalls} />
    </group>
  )
}
