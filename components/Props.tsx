'use client'

import { Instance, Instances } from '@react-three/drei'
import type { AssetName } from '@/components/scene-assets'
import { TILE, useSceneAsset } from '@/components/scene-assets'
import type { BlockLayout } from '@/components/scene-utils'
import { jitterFor, streetGrid } from '@/components/scene-utils'

interface PropsProps {
  layout: BlockLayout
}

interface Placement {
  key: string
  pos: [number, number, number]
  rotY?: number
  scale?: number
}

function Scattered({
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
        <Instance
          key={p.key}
          position={p.pos}
          rotation-y={p.rotY ?? 0}
          scale={p.scale ?? 1}
        />
      ))}
    </Instances>
  )
}

/**
 * Street furniture and planting.
 *
 * Everything here is placed deterministically. jitterFor() hashes a string into
 * a stable pseudo-random set, which is the same trick the plots use to avoid
 * reading as a spreadsheet — a town that reshuffled between renders would also
 * reshuffle between demo takes.
 *
 * The street lamps are unlit and tinted to KERB. design.md section 3 gives
 * --lamp exactly one meaning, and a street light that glowed the same colour as
 * a volunteer's window would make the scene unreadable at the moment it matters
 * most.
 *
 * Nothing here moves either: design.md section 4 allows one orchestrated
 * moment, and it belongs to a light coming up when somebody shows up.
 */
export default function Props({ layout }: PropsProps) {
  const grid = streetGrid(layout)
  const { road, width, depth, foodBank } = layout

  const trees: Record<'street' | 'apple' | 'conifer' | 'bare', Placement[]> = {
    street: [],
    apple: [],
    conifer: [],
    bare: [],
  }
  const lamps: Placement[] = []
  const benches: Placement[] = []
  const planters: Placement[] = []
  const cars: Placement[] = []

  // Just off the carriageway edge, inside the planting strip the wider road
  // corridor opens up — not at +/- TILE, which lands on the lot columns.
  const verges = [road.x - TILE * 0.78, road.x + TILE * 0.78]
  const kinds = ['street', 'apple', 'conifer', 'bare'] as const

  // Planting down both pavements of the vertical street.
  for (const z of grid.vertical) {
    if (Math.abs(z - road.z) < TILE) continue
    if (Math.abs(z - grid.avenueZ) < TILE) continue
    for (const x of verges) {
      const seed = jitterFor(`tree-${x}-${z}`)
      if (seed.widthScale < 0.94) continue
      const kind = kinds[Math.floor(Math.abs(seed.rotation) * 1000) % kinds.length]
      trees[kind].push({
        key: `t-${x}-${z}`,
        pos: [x + seed.offsetX * 0.6, 0, z + seed.offsetZ * 0.6],
        rotY: seed.rotation * 6,
        scale: 0.8 + seed.heightScale * 0.25,
      })
    }
  }

  // And along the cross street, thinned out so the junction stays legible.
  for (const x of grid.horizontal) {
    if (Math.abs(x - road.x) < TILE * 1.5) continue
    const seed = jitterFor(`xtree-${x}`)
    if (seed.depthScale < 1.0) continue
    trees.street.push({
      key: `xt-${x}`,
      pos: [x + seed.offsetX, 0, road.z + TILE * 0.78],
      rotY: seed.rotation * 6,
      scale: 0.85 + seed.heightScale * 0.2,
    })
  }

  // Lamps at a regular spacing — infrastructure reads as placed, not scattered.
  for (const z of grid.vertical) {
    if (Math.abs(z % (TILE * 2)) > 0.01) continue
    if (Math.abs(z - road.z) < TILE) continue
    lamps.push({ key: `lz-${z}`, pos: [road.x + TILE * 0.74, 0, z] })
  }
  for (const x of grid.horizontal) {
    if (Math.abs(x % (TILE * 2)) > 0.01) continue
    if (Math.abs(x - road.x) < TILE) continue
    lamps.push({
      key: `lx-${x}`,
      pos: [x, 0, road.z + TILE * 0.74],
      rotY: Math.PI / 2,
    })
  }

  // A place to sit at the junction, and one facing the food bank.
  benches.push({ key: 'b1', pos: [road.x + TILE * 0.7, 0, road.z + TILE * 1.4] })
  benches.push({
    key: 'b2',
    pos: [foodBank.x - TILE * 1.1, 0, grid.avenueZ + TILE * 0.7],
    rotY: Math.PI,
  })
  planters.push({ key: 'p1', pos: [road.x - TILE * 0.7, 0, road.z + TILE * 1.3] })
  planters.push({
    key: 'p2',
    pos: [foodBank.x + TILE * 1.2, 0, grid.avenueZ + TILE * 0.7],
  })

  // A few cars parked along the kerb. Parked, never driving — see the note on
  // motion above.
  const parking: [number, number, number][] = [
    [road.x + TILE * 0.55, 0, -depth / 2 + TILE * 0.5],
    [road.x - TILE * 0.55, 0, depth / 2 - TILE * 1.2],
    [width / 2 - TILE * 0.8, 0, road.z + TILE * 0.55],
  ]
  parking.forEach((pos, index) => {
    cars.push({ key: `c${index}`, pos, rotY: index === 2 ? Math.PI / 2 : 0 })
  })

  return (
    <group>
      <Scattered asset="streetTree" placements={trees.street} />
      <Scattered asset="appleTree" placements={trees.apple} />
      <Scattered asset="conifer" placements={trees.conifer} />
      <Scattered asset="bareTree" placements={trees.bare} />
      <Scattered asset="streetLamp" placements={lamps} />
      <Scattered asset="bench" placements={benches} />
      <Scattered asset="planter" placements={planters} />
      <Scattered asset="car" placements={cars} />
      <Scattered
        asset="busShelter"
        placements={[
          {
            key: 'shelter',
            pos: [foodBank.x + TILE * 2.2, 0, grid.avenueZ + TILE * 0.8],
            rotY: Math.PI,
          },
        ]}
      />
    </group>
  )
}
