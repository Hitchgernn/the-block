'use client'

import { Instance, Instances } from '@react-three/drei'
import type { AssetName } from '@/components/scene-assets'
import { TILE, useSceneAsset } from '@/components/scene-assets'
import type { BlockLayout } from '@/components/scene-utils'
import { LOT, classifyCell, jitterFor } from '@/components/scene-utils'

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
  const { road, ground } = layout

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

      // classifyCell is the only thing that decides what a cell is. Props.tsx
      // reads the same function to work out what a prop is standing on.
      switch (classifyCell(layout, x, z)) {
        case 'junction':
          junctions.push({ key, pos })
          break
        case 'road':
          // Rotated when the street runs across rather than up the screen.
          carriageway.push({
            key,
            pos,
            rotY: near(x, road.x) ? 0 : Math.PI / 2,
          })
          break
        case 'pavement':
          pavement.push({ key, pos })
          break
        case 'grass': {
          const seed = jitterFor(`verge-${x}-${z}`)
          ;(seed.widthScale > 1.04 ? leaf : verge).push({ key, pos })
          break
        }
        // 'lot' and 'plaza' bring their own ground; 'bare' is the plinth
        // showing through.
        default:
          break
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
