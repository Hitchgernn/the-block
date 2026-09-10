'use client'

import { Instance, Instances } from '@react-three/drei'
import type { AssetName } from '@/components/scene-assets'
import { TILE, useSceneAsset } from '@/components/scene-assets'
import type { BlockLayout } from '@/components/scene-utils'
import { LOT, jitterFor } from '@/components/scene-utils'

interface StreetProps {
  layout: BlockLayout
}

interface Placement {
  key: string
  pos: [number, number, number]
  rotY?: number
}

/** One instanced draw call per asset, however many tiles are placed. */
function Tiles({
  asset,
  placements,
}: {
  asset: AssetName
  placements: Placement[]
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

const near = (a: number, b: number) => Math.abs(a - b) < 0.01

/**
 * The streets, laid as a classified tile grid.
 *
 * Every cell of the ground is walked once and asked what it is — carriageway,
 * junction, pavement, or grass — rather than each kind being scattered by its
 * own loop. The loops disagreed: pavement was laid at a fixed offset from the
 * road and ran straight through the lots beside it, and because the street
 * axes did not land on the tile grid, no cell was ever recognised as a
 * crossing, so the junction had pavement in the middle of it instead of an
 * intersection piece.
 *
 * The corridor is three tiles wide — pavement, carriageway, pavement — which is
 * exactly `ROAD_GAP`, so pavement meets the lot edge and stops.
 */
export default function Street({ layout }: StreetProps) {
  const { road, avenueZ, ground } = layout

  const carriageway: Placement[] = []
  const junctions: Placement[] = []
  const pavement: Placement[] = []
  const verge: Placement[] = []
  const leaf: Placement[] = []

  // The cell grid is anchored to the streets themselves, not to the world
  // origin. road.z lands at -2 for the current block, so a grid stepping from
  // an arbitrary edge never put a cell centre on the horizontal street: it was
  // never recognised as road at all, and the crossing got pavement instead of a
  // junction. Lots share this offset, so anchoring here aligns everything.
  const originX = road.x
  const originZ = road.z
  const firstX = originX - Math.ceil((originX - (-ground.halfX - TILE)) / LOT) * LOT
  const firstZ = originZ - Math.ceil((originZ - (ground.farZ - TILE)) / LOT) * LOT
  const toX = ground.halfX + TILE
  const toZ = ground.nearZ + TILE

  for (let x = firstX; x <= toX + 0.01; x += LOT) {
    for (let z = firstZ; z <= toZ + 0.01; z += LOT) {
      const key = `${x},${z}`
      const pos: [number, number, number] = [x, 0, z]

      const onVertical = near(x, road.x)
      const onCross = near(z, road.z)
      const onAvenue = near(z, avenueZ)
      const onHorizontal = onCross || onAvenue

      if (onVertical && onHorizontal) {
        junctions.push({ key, pos })
        continue
      }
      if (onVertical) {
        carriageway.push({ key, pos })
        continue
      }
      if (onHorizontal) {
        carriageway.push({ key, pos, rotY: Math.PI / 2 })
        continue
      }

      // One tile either side of every carriageway is pavement. That is the
      // whole of the remaining corridor, so it cannot reach a lot.
      const besideVertical = near(Math.abs(x - road.x), TILE)
      const besideHorizontal =
        near(Math.abs(z - road.z), TILE) || near(Math.abs(z - avenueZ), TILE)
      if (besideVertical || besideHorizontal) {
        pavement.push({ key, pos })
        continue
      }

      // Grass rims the block. Inside it are the lots, which draw themselves.
      const outside =
        Math.abs(x) > ground.halfX - 0.01 ||
        z > ground.nearZ - 0.01 ||
        z < ground.farZ + 0.01
      if (outside) {
        const seed = jitterFor(`verge-${x}-${z}`)
        ;(seed.widthScale > 1.04 ? leaf : verge).push({ key, pos })
      }
    }
  }

  return (
    <group>
      <Tiles asset="roadStraight" placements={carriageway} />
      <Tiles asset="roadIntersection" placements={junctions} />
      <Tiles asset="sidewalk" placements={pavement} />
      <Tiles asset="grassVerge" placements={verge} />
      <Tiles asset="leafLawn" placements={leaf} />
    </group>
  )
}
