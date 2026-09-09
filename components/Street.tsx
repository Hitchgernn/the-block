'use client'

import { Instance, Instances } from '@react-three/drei'
import type { AssetName } from '@/components/scene-assets'
import { TILE, useSceneAsset } from '@/components/scene-assets'
import type { BlockLayout } from '@/components/scene-utils'
import { LOT, jitterFor, streetGrid } from '@/components/scene-utils'

interface StreetProps {
  layout: BlockLayout
}

/** One instanced draw call per asset, however many tiles are placed. */
function Tiles({
  asset,
  placements,
}: {
  asset: AssetName
  placements: { key: string; pos: [number, number, number]; rotY?: number }[]
}) {
  const loaded = useSceneAsset(asset)
  if (!loaded || placements.length === 0) return null

  return (
    <Instances
      geometry={loaded.geometry}
      material={loaded.material}
      limit={Math.max(1, placements.length)}
      frustumCulled={false}
    >
      {placements.map((p) => (
        <Instance key={p.key} position={p.pos} rotation-y={p.rotY ?? 0} />
      ))}
    </Instances>
  )
}

/**
 * The streets, laid from the pack's 4-unit road tiles.
 *
 * Tile positions come from streetGrid(), which reads the same layout object the
 * lots are placed from, so the carriageway cannot drift away from the gap it is
 * supposed to sit in.
 *
 * Everything repeated goes through <Instances>. Around forty road and pavement
 * tiles at eight to twenty thousand vertices each would otherwise put half a
 * million vertices on screen for scenery, which is more than the twenty-three
 * plots the scene is actually about.
 */
export default function Street({ layout }: StreetProps) {
  const grid = streetGrid(layout)
  const { road, width, depth } = layout

  const roadTiles: { key: string; pos: [number, number, number]; rotY?: number }[] = []
  const junctions: { key: string; pos: [number, number, number] }[] = []

  // Vertical street.
  for (const z of grid.vertical) {
    const atCross = Math.abs(z - road.z) < LOT / 2
    const atAvenue = Math.abs(z - grid.avenueZ) < LOT / 2
    if (atCross || atAvenue) {
      junctions.push({ key: `j-v-${z}`, pos: [road.x, 0, z] })
    } else {
      roadTiles.push({ key: `v-${z}`, pos: [road.x, 0, z] })
    }
  }

  // Horizontal cross street and the avenue in front of the food bank.
  for (const x of grid.horizontal) {
    if (Math.abs(x - road.x) >= LOT / 2) {
      roadTiles.push({ key: `h-${x}`, pos: [x, 0, road.z], rotY: Math.PI / 2 })
    }
  }
  for (const x of grid.avenue) {
    if (Math.abs(x - road.x) >= LOT / 2) {
      roadTiles.push({
        key: `a-${x}`,
        pos: [x, 0, grid.avenueZ],
        rotY: Math.PI / 2,
      })
    }
  }

  // Pavement runs either side of both streets, one tile out.
  const pavement: { key: string; pos: [number, number, number] }[] = []
  for (const z of grid.vertical) {
    for (const side of [-TILE, TILE]) {
      pavement.push({ key: `pv-${z}-${side}`, pos: [road.x + side, 0, z] })
    }
  }
  for (const x of grid.horizontal) {
    for (const side of [-TILE, TILE]) {
      if (Math.abs(x - road.x) < LOT) continue
      pavement.push({ key: `ph-${x}-${side}`, pos: [x, 0, road.z + side] })
    }
  }

  // A continuous band of grass around the whole block, so the streets end in
  // something rather than at the edge of the ground plane. Walking the ring as
  // a rectangle rather than as four independent loops keeps the corners filled
  // instead of leaving the diagonal gaps a naive pass produces.
  const verge: { key: string; pos: [number, number, number] }[] = []
  const halfX = Math.ceil((width / 2 + TILE) / TILE) * TILE
  const nearZ = Math.ceil((depth / 2 + TILE) / TILE) * TILE
  const farZ = Math.floor((grid.avenueZ - TILE * 2) / TILE) * TILE
  const rings = 1

  // Some tiles come up as leaf litter instead of plain grass, so the ring is
  // not a single flat colour. Chosen from the position hash rather than at
  // random — the ground must not reshuffle between renders.
  const leaf: { key: string; pos: [number, number, number] }[] = []
  const place = (key: string, pos: [number, number, number]) => {
    const seed = jitterFor(`verge-${pos[0]}-${pos[2]}`)
    ;(seed.widthScale > 1.04 ? leaf : verge).push({ key, pos })
  }

  for (let x = -halfX; x <= halfX; x += TILE) {
    for (let ring = 0; ring < rings; ring += 1) {
      place(`gn${x}-${ring}`, [x, 0, nearZ + ring * TILE])
      place(`gf${x}-${ring}`, [x, 0, farZ - ring * TILE])
    }
  }
  for (let z = farZ; z <= nearZ; z += TILE) {
    for (let ring = 0; ring < rings; ring += 1) {
      place(`gl${z}-${ring}`, [-halfX - ring * TILE, 0, z])
      place(`gr${z}-${ring}`, [halfX + ring * TILE, 0, z])
    }
  }

  return (
    <group>
      <Tiles asset="roadStraight" placements={roadTiles} />
      <Tiles asset="roadIntersection" placements={junctions} />
      <Tiles asset="sidewalk" placements={pavement} />
      <Tiles asset="grassVerge" placements={verge} />
      <Tiles asset="leafLawn" placements={leaf} />
    </group>
  )
}
