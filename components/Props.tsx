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
      name={asset}
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
 * Which way each asset's front points before any rotation.
 *
 * Measured from the GLB bounds rather than guessed. street-lamp-01 runs
 * x -0.28..1.51 with the pole at the origin, so its arm reaches +x; it carried
 * no rotation at all, which left every arm hanging over the houses instead of
 * the road.
 */
const FRONT = {
  lamp: [1, 0],
  bench: [0, 1],
  planter: [0, 1],
} as const

/**
 * Turn something so its front points the given way.
 *
 * A rotation of theta sends a front of (fx, fz) to (fx cos + fz sin, ...), so
 * the rotation wanted is just the difference of the two bearings.
 */
function aim(
  front: readonly [number, number],
  towards: readonly [number, number],
): number {
  return Math.atan2(towards[0], towards[1]) - Math.atan2(front[0], front[1])
}

/**
 * The same, for something whose street has to be worked out from where it
 * stands. Only safe when the thing is nearer its own street than the crossing
 * one — a lamp moved out to the far kerb is not, so those pass a direction.
 */
function aimAtStreet(
  layout: BlockLayout,
  x: number,
  z: number,
  front: readonly [number, number],
): number {
  const dx = x - layout.road.x
  const toCross = z - layout.road.z
  const toAvenue = z - layout.avenueZ
  const dz = Math.abs(toCross) < Math.abs(toAvenue) ? toCross : toAvenue

  // A tie goes to the street running across, which is the one a bench on a
  // corner sits along.
  const towards: [number, number] =
    Math.abs(dx) < Math.abs(dz) ? [dx > 0 ? -1 : 1, 0] : [0, dz > 0 ? -1 : 1]

  return aim(front, towards)
}

/** Roughly how much pavement each thing takes up, in world units. */
const FOOTPRINT = {
  /** The food bank is 6.4 by 6.26, plus its canopy. */
  building: 4.2,
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
 * there. Those two numbers were 0.16 apart, so a lamp grew out of a tree at
 * every second spacing.
 *
 * Earlier lists win, so the fixed things — the lamps that have to be evenly
 * spaced to read as infrastructure — keep their spots and the trees, of which
 * there are many and no particular one matters, give way.
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
  const benches: Placement[] = []
  const planters: Placement[] = []
  const cars: Placement[] = []

  // Just off the carriageway edge, inside the planting strip the wider road
  // corridor opens up — not at +/- TILE, which lands on the lot columns.
  //
  // One number for the whole planting line. The lamps stood on a second offset
  // of their own, which first put them 0.16 from the trees — inside the
  // canopies — and then, pushed out to the far kerb to separate them, left
  // them off the line altogether and too far from the road to light it. They
  // share the line now and are staggered along it instead.
  const VERGE = TILE * 0.78
  const verges = [road.x - VERGE, road.x + VERGE]
  type Species = 'street' | 'apple' | 'conifer' | 'bare'

  /**
   * Which trees grow in which corner of the block.
   *
   * The species were picked from one hash across the whole town, so all four
   * quadrants came out the same mixture and a viewer spinning the camera had
   * nothing to tell one corner from another. Each quadrant now leans on a
   * species without becoming a monoculture — enough that "the conifer corner"
   * means something.
   *
   * This is scenery and says nothing about anybody: the trees are not derived
   * from the event log and must never look as though they are.
   */
  const PLANTING: Record<number, readonly Species[]> = {
    0: ['conifer', 'conifer', 'street', 'apple'],
    1: ['apple', 'apple', 'street', 'bare'],
    2: ['street', 'street', 'bare', 'conifer'],
    3: ['bare', 'street', 'apple', 'street'],
  }
  const quadrant = (x: number, z: number) =>
    (x >= road.x ? 1 : 0) + (z >= road.z ? 2 : 0)
  const species = (x: number, z: number, seed: ReturnType<typeof jitterFor>): Species =>
    PLANTING[quadrant(x, z)][Math.floor(Math.abs(seed.rotation) * 1000) % 4]

  // Planting down both pavements of the vertical street.
  for (const z of grid.vertical) {
    if (Math.abs(z - road.z) < TILE) continue
    if (Math.abs(z - grid.avenueZ) < TILE) continue
    for (const x of verges) {
      const seed = jitterFor(`tree-${x}-${z}`)
      if (seed.widthScale < 0.94) continue
      const kind = species(x, z, seed)
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
    trees[species(x, road.z + VERGE, seed)].push({
      key: `xt-${x}`,
      pos: [x + seed.offsetX, PAVEMENT, road.z + VERGE],
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
  // On the tree line, offset half a tile along it, so each lamp stands midway
  // between two trees. Two units apart against a 1.6 clearance, and the arm
  // reaches from 3.12 to 1.61 — over the kerb and above the carriageway.
  for (const z of grid.vertical) {
    if (Math.abs(z % (TILE * 2)) > 0.01) continue
    const at = z + TILE / 2
    if (Math.abs(at - road.z) < TILE) continue
    const x = road.x + VERGE
    lamps.push({
      key: `lz-${z}`,
      pos: [x, PAVEMENT, at],
      // This loop lines the vertical street, so the carriageway is at -x. At
      // 1.3 tiles out the lamp is nearer the crossing street than its own, and
      // asking which axis is closest turned every arm the wrong way.
      rotY: aim(FRONT.lamp, [-1, 0]),
    })
  }
  for (const x of grid.horizontal) {
    if (Math.abs(x % (TILE * 2)) > 0.01) continue
    const at = x + TILE / 2
    if (Math.abs(at - road.x) < TILE) continue
    const z = road.z + VERGE
    lamps.push({
      key: `lx-${x}`,
      pos: [at, PAVEMENT, z],
      rotY: aim(FRONT.lamp, [0, -1]),
    })
  }

  // A place to sit at the junction, and one facing the food bank.
  // Turned to the road rather than left at whatever rotation they were pushed
  // with. A bench facing a garden wall is a bench nobody sits on.
  for (const [key, x, z] of [
    ['b1', road.x + TILE * 0.7, road.z + TILE * 1.4],
    ['b2', foodBank.x - TILE * 1.1, grid.avenueZ + TILE * 0.7],
  ] as const) {
    benches.push({ key, pos: [x, PAVEMENT, z], rotY: aimAtStreet(layout, x, z, FRONT.bench) })
  }
  for (const [key, x, z] of [
    ['p1', road.x - TILE * 0.7, road.z + TILE * 1.3],
    ['p2', foodBank.x + TILE * 1.2, grid.avenueZ + TILE * 0.7],
  ] as const) {
    planters.push({ key, pos: [x, PAVEMENT, z], rotY: aimAtStreet(layout, x, z, FRONT.planter) })
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
  // The two benches face each other across the park, which is what benches in
  // a park do. Everything else here faces the street: the planters were pushed
  // with no rotation at all, so they sat square to the world rather than to
  // anything around them.
  benches.push({ key: 'pb1', pos: [parkX - TILE * 0.4, PLAZA, parkZ], rotY: Math.PI / 2 })
  benches.push({ key: 'pb2', pos: [parkX + TILE * 0.4, PLAZA, parkZ], rotY: -Math.PI / 2 })
  for (const [key, x, z] of [
    ['pp1', parkX, parkZ - TILE * 0.75],
    ['pp2', parkX, parkZ + TILE * 0.75],
  ] as const) {
    planters.push({
      key,
      pos: [x, PLAZA, z],
      rotY: aimAtStreet(layout, x, z, FRONT.planter),
    })
  }
  lamps.push({
    key: 'pl1',
    pos: [parkX + TILE * 0.95, PLAZA, parkZ - TILE * 0.6],
    rotY: aim(FRONT.lamp, [-1, 0]),
  })

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
  // the same place. Order is priority: the evenly spaced lamps hold their
  // spots, trees give way.
  // The food bank claims its own footprint first, so nothing plants itself
  // inside the building. A street tree was growing through its front wall.
  const building: Placement[] = [
    { key: 'food-bank', pos: [foodBank.x, 0, foodBank.z] },
  ]

  deconflict([
    [building, FOOTPRINT.building],
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
      <Scattered asset="streetTree" placements={trees.street} />
      <Scattered asset="appleTree" placements={trees.apple} />
      <Scattered asset="conifer" placements={trees.conifer} />
      <Scattered asset="bareTree" placements={trees.bare} />
      <Scattered asset="streetLamp" placements={lamps} />
      <Scattered asset="bench" placements={benches} />
      <Scattered asset="planter" placements={planters} />
      <Scattered asset="car" placements={cars} />
    </group>
  )
}
