'use client'

import { Instance, Instances } from '@react-three/drei'
import type { AssetName } from '@/components/scene-assets'
import { SURFACE_TOP, TILE, useSceneAsset } from '@/components/scene-assets'
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
 * Every prop is lifted onto the surface it actually stands on. The pack's
 * ground tiles are not flat and not equal — pavement stands 0.48 above y=0,
 * the carriageway 0.28, plaza paving 0.53 — so a prop placed at y=0 sinks by
 * that much. The benches were showing only their top slats and the planters
 * only their flowers before this. See SURFACE_TOP in scene-assets.ts.
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
const PAVEMENT = SURFACE_TOP.sidewalk
const ROAD_TOP = SURFACE_TOP.road
const PLAZA = SURFACE_TOP.plaza

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
        pos: [x + seed.offsetX * 0.6, PAVEMENT, z + seed.offsetZ * 0.6],
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
      pos: [x + seed.offsetX, PAVEMENT, road.z + TILE * 0.78],
      rotY: seed.rotation * 6,
      scale: 0.85 + seed.heightScale * 0.2,
    })
  }

  // Lamps at a regular spacing — infrastructure reads as placed, not scattered.
  for (const z of grid.vertical) {
    if (Math.abs(z % (TILE * 2)) > 0.01) continue
    if (Math.abs(z - road.z) < TILE) continue
    lamps.push({ key: `lz-${z}`, pos: [road.x + TILE * 0.74, PAVEMENT, z] })
  }
  for (const x of grid.horizontal) {
    if (Math.abs(x % (TILE * 2)) > 0.01) continue
    if (Math.abs(x - road.x) < TILE) continue
    lamps.push({
      key: `lx-${x}`,
      pos: [x, PAVEMENT, road.z + TILE * 0.74],
      rotY: Math.PI / 2,
    })
  }

  // A place to sit at the junction, and one facing the food bank.
  benches.push({ key: 'b1', pos: [road.x + TILE * 0.7, PAVEMENT, road.z + TILE * 1.4] })
  benches.push({
    key: 'b2',
    pos: [foodBank.x - TILE * 1.1, PAVEMENT, grid.avenueZ + TILE * 0.7],
    rotY: Math.PI,
  })
  planters.push({ key: 'p1', pos: [road.x - TILE * 0.7, PAVEMENT, road.z + TILE * 1.3] })
  planters.push({
    key: 'p2',
    pos: [foodBank.x + TILE * 1.2, PAVEMENT, grid.avenueZ + TILE * 0.7],
  })

  // A few cars parked along the kerb. Parked, never driving — see the note on
  // motion above.
  // Against the kerb, inside the carriageway. The carriageway is 4 wide, so
  // its edge is 2 from the centreline and a car half a unit wide parks at
  // about 1.35. At TILE * 0.55 they sat at 2.2 — past the kerb, on the
  // pavement, and sunk because they were placed at road height while standing
  // on a surface 0.2 higher. Widening the street corridor moved the road out
  // from under them.
  const KERB_OFFSET = 1.35
  const parking: [number, number, number][] = [
    [road.x + KERB_OFFSET, ROAD_TOP, -depth / 2 + TILE * 0.5],
    [road.x - KERB_OFFSET, ROAD_TOP, depth / 2 - TILE * 1.2],
    [width / 2 - TILE * 0.8, ROAD_TOP, road.z - KERB_OFFSET],
  ]
  parking.forEach((pos, index) => {
    cars.push({ key: `c${index}`, pos, rotY: index === 2 ? Math.PI / 2 : 0 })
  })

  // A pocket park on the way to the food bank.
  //
  // The town had one landmark and every corner of the block looked like every
  // other corner. This gives it a second place and something to orient by, and
  // it sits on the route people walk between the houses and the shift — which
  // is also somewhere to wait.
  //
  // It is scenery: no state, no growth, nothing derived. The plots remain the
  // only things in the scene that mean anything.
  // Positioned from the block's own extent, not from the food bank. Anchoring
  // it relative to the shop put it on top of the lot grid the moment the
  // volunteer count grew the block by a row.
  const parkX = width / 2 + TILE * 1.7
  const parkZ = -depth / 6
  const paving: Placement[] = []
  for (const dx of [-0.5, 0.5]) {
    for (const dz of [-0.5, 0.5]) {
      paving.push({
        key: `pk${dx}${dz}`,
        pos: [parkX + dx * TILE, 0, parkZ + dz * TILE],
      })
    }
  }
  // Inside the paving, not past its edge. The four paving tiles reach one tile
  // from centre, so trees at 1.1 stood on the grass beyond it while being
  // placed at plaza height — half sunk, and clearly on the wrong ground.
  for (const [i, [dx, dz]] of ([[-0.78, -0.72], [0.8, -0.66], [-0.7, 0.76], [0.74, 0.8]] as const).entries()) {
    const seed = jitterFor(`park-${i}`)
    const target = i % 2 === 0 ? trees.apple : trees.conifer
    target.push({
      key: `pt${i}`,
      pos: [parkX + dx * TILE, PLAZA, parkZ + dz * TILE],
      rotY: seed.rotation * 6,
      scale: 0.85 + seed.heightScale * 0.2,
    })
  }
  benches.push({ key: 'pb1', pos: [parkX - TILE * 0.4, PLAZA, parkZ], rotY: Math.PI / 2 })
  benches.push({ key: 'pb2', pos: [parkX + TILE * 0.4, PLAZA, parkZ], rotY: -Math.PI / 2 })
  planters.push({ key: 'pp1', pos: [parkX, PLAZA, parkZ - TILE * 0.75] })
  planters.push({ key: 'pp2', pos: [parkX, PLAZA, parkZ + TILE * 0.75] })
  lamps.push({ key: 'pl1', pos: [parkX + TILE * 0.95, PLAZA, parkZ - TILE * 0.6] })

  return (
    <group>
      <Scattered asset="plazaPaving" placements={paving} />
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
            // On the pavement flanking the vertical street where it meets the
            // avenue, which is the corner people actually walk to the shift
            // from. It used to stand at (8.8, -12.8) — inside the lot at
            // (8, -12), its canopy across somebody's house.
            pos: [road.x - TILE, PAVEMENT, grid.avenueZ + TILE],
            rotY: Math.PI,
          },
        ]}
      />
    </group>
  )
}
