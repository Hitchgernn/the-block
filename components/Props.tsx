'use client'

import { Instance, Instances } from '@react-three/drei'
import type { AssetName } from '@/components/scene-assets'
import { SURFACE_TOP, TILE, useSceneAsset } from '@/components/scene-assets'
import type { BlockLayout } from '@/components/scene-utils'
import { jitterFor, streetGrid, surfaceAt } from '@/components/scene-utils'

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

/**
 * Sit a list of street props on whatever they are actually standing on, and
 * drop the ones standing somewhere no prop belongs.
 *
 * Each of these was pushed at pavement height because the pavement is where
 * most of them go. It is not where all of them went: the outer street trees
 * landed on the grass verge and sank 0.36 into it, and the lamp where the
 * vertical street meets the avenue stood in the carriageway, floating 0.2
 * above it. Asking classifyCell — the same function that decides which tile
 * gets laid there — is the only way the two can agree.
 *
 * The pocket park is settled by hand afterwards, because its props stand on
 * paving it brings with it rather than on the cell underneath.
 */
function settle(layout: BlockLayout, list: Placement[]) {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const item = list[i]
    const surface = surfaceAt(layout, item.pos[0], item.pos[2])
    const top =
      surface === 'grass'
        ? SURFACE_TOP.grass
        : surface === 'plaza'
          ? SURFACE_TOP.plaza
          : surface === 'pavement'
            ? SURFACE_TOP.sidewalk
            : null
    if (top !== null) {
      item.pos = [item.pos[0], top, item.pos[2]]
    } else {
      list.splice(i, 1)
    }
  }
}

/**
 * Which way something on the pavement should face.
 *
 * A bench with its back to the road is furniture nobody would sit on. The
 * asset's front is +z, so a rotation of theta points it at (sin, 0, cos).
 * The nearer of the two street axes wins, which is the same question the
 * pavement classification already answers.
 */
function facingStreet(layout: BlockLayout, x: number, z: number): number {
  const dx = x - layout.road.x
  const toCross = z - layout.road.z
  const toAvenue = z - layout.avenueZ
  const dz = Math.abs(toCross) < Math.abs(toAvenue) ? toCross : toAvenue
  if (Math.abs(dx) < Math.abs(dz)) return dx > 0 ? -Math.PI / 2 : Math.PI / 2
  return dz > 0 ? Math.PI : 0
}

/** Roughly how much pavement each thing takes up, in world units. */
const FOOTPRINT = {
  shelter: 2.3,
  car: 1.6,
  tree: 1.15,
  bench: 0.9,
  lamp: 0.45,
  planter: 0.55,
} as const

/**
 * Nothing stands inside anything else.
 *
 * Every prop here is placed by its own rule — trees down the verge at 0.78 of
 * a tile, lamps at 0.74 — and no rule knew what the others had already put
 * there. Those two numbers are 0.16 apart, so a lamp grew out of a tree at
 * every second spacing, and a tree stood 0.88 from the middle of the bus
 * shelter, through its roof.
 *
 * Earlier lists win, so the fixed things — the shelter, the lamps that have to
 * be evenly spaced to read as infrastructure — keep their spots and the trees,
 * of which there are many and no particular one matters, give way.
 */
function deconflict(lists: [Placement[], number][]) {
  const taken: { x: number; z: number; r: number }[] = []
  for (const [list, radius] of lists) {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const [x, , z] = list[i].pos
      const clash = taken.some(
        (t) => Math.hypot(t.x - x, t.z - z) < t.r + radius,
      )
      if (clash) list.splice(i, 1)
    }
    for (const item of list) {
      taken.push({ x: item.pos[0], z: item.pos[2], r: radius })
    }
  }
}

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
  // On the pavement flanking the vertical street where it meets the avenue,
  // which is the corner people actually walk to the shift from. It used to
  // stand at (8.8, -12.8) — inside the lot at (8, -12), its canopy across
  // somebody's house. It is placed before anything else so nothing else lands
  // on top of it.
  const shelters: Placement[] = [
    {
      key: 'shelter',
      pos: [layout.road.x - TILE, PAVEMENT, layout.avenueZ + TILE],
      rotY: Math.PI,
    },
  ]
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
  //
  // Out at 1.3 tiles rather than 0.74, against the outer edge of the pavement.
  // The trees plant at 0.78, so at 0.74 the two lines were 0.16 apart and every
  // lamp stood inside a canopy; the collision pass then answered that by
  // deleting the tree, which cost half the planting to fix a spacing mistake.
  // Two lines two tiles apart both survive.
  for (const z of grid.vertical) {
    if (Math.abs(z % (TILE * 2)) > 0.01) continue
    if (Math.abs(z - road.z) < TILE) continue
    lamps.push({ key: `lz-${z}`, pos: [road.x + TILE * 1.3, PAVEMENT, z] })
  }
  for (const x of grid.horizontal) {
    if (Math.abs(x % (TILE * 2)) > 0.01) continue
    if (Math.abs(x - road.x) < TILE) continue
    lamps.push({
      key: `lx-${x}`,
      pos: [x, PAVEMENT, road.z + TILE * 1.3],
      rotY: Math.PI / 2,
    })
  }

  // A place to sit at the junction, and one facing the food bank.
  // Turned to the road rather than left at whatever rotation they were pushed
  // with. A bench facing a garden wall is a bench nobody sits on.
  for (const [key, x, z] of [
    ['b1', road.x + TILE * 0.7, road.z + TILE * 1.4],
    ['b2', foodBank.x - TILE * 1.1, grid.avenueZ + TILE * 0.7],
  ] as const) {
    benches.push({ key, pos: [x, PAVEMENT, z], rotY: facingStreet(layout, x, z) })
  }
  for (const [key, x, z] of [
    ['p1', road.x - TILE * 0.7, road.z + TILE * 1.3],
    ['p2', foodBank.x + TILE * 1.2, grid.avenueZ + TILE * 0.7],
  ] as const) {
    planters.push({ key, pos: [x, PAVEMENT, z], rotY: facingStreet(layout, x, z) })
  }

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
  // Snapped to a cell corner by layoutPlots, so the four paving tiles below
  // replace four whole ground cells instead of straddling sixteen of them.
  const { x: parkX, z: parkZ } = layout.park
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

  // Everything above chose where it stands; this decides what it stands on.
  // The park's cells classify as plaza because it lays its own paving there,
  // so its benches and trees come out at plaza height without a special case.
  for (const list of [
    trees.street,
    trees.apple,
    trees.conifer,
    trees.bare,
    lamps,
    benches,
    planters,
  ]) {
    settle(layout, list)
  }

  // Then, with everything on its real ground, make sure no two things are in
  // the same place. Order is priority: the shelter and the evenly spaced lamps
  // hold their spots, trees give way.
  deconflict([
    [shelters, FOOTPRINT.shelter],
    [cars, FOOTPRINT.car],
    [lamps, FOOTPRINT.lamp],
    [benches, FOOTPRINT.bench],
    [planters, FOOTPRINT.planter],
    [trees.street, FOOTPRINT.tree],
    [trees.apple, FOOTPRINT.tree],
    [trees.conifer, FOOTPRINT.tree],
    [trees.bare, FOOTPRINT.tree],
  ])

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
      <Scattered asset="busShelter" placements={shelters} />
    </group>
  )
}
