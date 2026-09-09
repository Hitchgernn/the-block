import * as THREE from 'three'
import type { Plot, Shift } from '@/lib/types'

/** docs/design.md section 3. --lamp only ever means "someone showed up". */
export const PALETTE = {
  dusk: '#2b3b52',
  duskDeep: '#1c2838',
  stone: '#dcd3c4',
  stoneDim: '#9aa3ae',
  lamp: '#ffc94a',
  lampSoft: '#ffe3a3',
  moss: '#7a9a72',
  brick: '#8c5a4a',
} as const

/** Foundation slabs sit between the empty-lot tone and a finished wall. */
export const SLAB = '#b6b2ab'
export const ROAD = '#22303f'
/** Street furniture. Deliberately outside the palette's warm end: none of it
 *  is allowed to glow, because --lamp only ever means someone showed up. */
export const KERB = '#46566b'
export const MARKING = '#5f6d80'

const LAMP = new THREE.Color(PALETTE.lamp)
const LAMP_SOFT = new THREE.Color(PALETTE.lampSoft)

/**
 * Quiet weeks pale the light from --lamp toward --lamp-soft and lower its
 * intensity. It never reaches dark and it never changes the geometry.
 */
export function lampColor(quietness: number): THREE.Color {
  return new THREE.Color().copy(LAMP).lerp(LAMP_SOFT, clamp01(quietness))
}

export function lampIntensity(quietness: number): number {
  return 1.05 - 0.62 * clamp01(quietness)
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

// ---------------------------------------------------------------- jitter

function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Jitter {
  /** Radians, within ±3°. */
  rotation: number
  widthScale: number
  depthScale: number
  heightScale: number
  /** A second smaller mass grafted onto the side of the house. */
  hasAnnex: boolean
  annexSide: 1 | -1
  hasChimney: boolean
  /** Small offset inside the lot so the row is not perfectly ruled. */
  offsetX: number
  offsetZ: number
  padRotation: number
}

/**
 * Deterministic from the volunteer id, so the town keeps its shape across
 * renders, refetches and reloads. design.md: this jitter is the whole
 * difference between a charming little town and a bar chart in 3D.
 */
export function jitterFor(volunteerId: string): Jitter {
  const rand = mulberry32(hashString(volunteerId))
  const deg = Math.PI / 180
  return {
    rotation: (rand() * 6 - 3) * deg,
    widthScale: 0.86 + rand() * 0.3,
    depthScale: 0.86 + rand() * 0.3,
    heightScale: 0.85 + rand() * 0.36,
    hasAnnex: rand() > 0.55,
    annexSide: rand() > 0.5 ? 1 : -1,
    hasChimney: rand() > 0.45,
    offsetX: rand() * 0.3 - 0.15,
    offsetZ: rand() * 0.3 - 0.15,
    padRotation: (rand() * 4 - 2) * deg,
  }
}

// ---------------------------------------------------------------- layout

/**
 * The asset pack's ground tiles are all exactly 4.00 x 4.00, so the lot grid
 * matches them one to one. At the old 3.0 a street lamp from the pack (4.10
 * tall) stood higher than a finished house, and a car (3.06 long) was longer
 * than a house was tall.
 */
export const LOT = 4.0
/**
 * Two tiles wide: one for the carriageway, one for the pavement and planting
 * either side of it. At a single tile the lots sat hard against the kerb and
 * there was a quarter of a unit to put a street tree in.
 */
export const ROAD_GAP = 8.0
const COLS = 6

export interface Placement {
  plot: Plot
  x: number
  z: number
}

/** How far in front of the block the food bank sits, across the near street. */
export const FORECOURT_DEPTH = 7.5

export interface BlockLayout {
  placements: Placement[]
  /** Extent of the housing grid alone. */
  width: number
  depth: number
  /** Centre line of each cross street. */
  road: { x: number; z: number }
  /** Where the food bank stands, facing the block. */
  foodBank: { x: number; z: number }
  /** Grid plus the food bank, so the camera can frame everything. */
  sceneDepth: number
}

/**
 * A grid of lots split by one cross street each way, then centred, with the
 * food bank set back in front of it.
 *
 * The road offsets are returned from here rather than recomputed elsewhere.
 * They used to live in a separate roadLines() that hardcoded `rowBreak = 1`
 * while this function used `floor(rows / 2)` — so with four rows of plots the
 * cross street was painted a whole lot away from the gap it belonged in. One
 * owner for the grid means the two halves cannot disagree again.
 */
export function layoutPlots(plots: Plot[]): BlockLayout {
  const rows = Math.max(1, Math.ceil(plots.length / COLS))
  const cols = Math.min(COLS, plots.length)
  const colBreak = Math.floor(COLS / 2)
  const rowBreak = Math.max(1, Math.floor(rows / 2))

  // The streets are laid for a full block even when few volunteers exist yet.
  // Sizing the footprint off the actual count collapsed an empty database to a
  // block with no extent, which pulled the camera in on top of the food bank
  // and stood the skyline right against the lens. Empty lots are an invitation
  // (design.md section 7), so the town should look like it is waiting rather
  // than like it is broken.
  const gridCols = Math.max(4, cols)
  const gridRows = Math.max(3, rows)

  const width = gridCols * LOT + ROAD_GAP
  const depth = gridRows * LOT + ROAD_GAP

  const placements = plots.map((plot, index) => {
    const col = index % COLS
    const row = Math.floor(index / COLS)
    const x = col * LOT + (col >= colBreak ? ROAD_GAP : 0) - width / 2 + LOT / 2
    const z = row * LOT + (row >= rowBreak ? ROAD_GAP : 0) - depth / 2 + LOT / 2
    return { plot, x, z }
  })

  return {
    placements,
    width,
    depth,
    road: {
      x: colBreak * LOT + ROAD_GAP / 2 - width / 2,
      z: rowBreak * LOT + ROAD_GAP / 2 - depth / 2,
    },
    foodBank: { x: 0, z: -depth / 2 - FORECOURT_DEPTH },
    sceneDepth: depth + FORECOURT_DEPTH * 2,
  }
}

// ------------------------------------------------------------------ copy

const WORDS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
]

/** design.md section 7: the interface rarely says a number out loud. */
export function numberWord(n: number): string {
  return WORDS[n] ?? String(n)
}

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

/**
 * Shift dates are logged in UTC and the slot label already carries the day,
 * so formatting in UTC keeps "Saturday 9am" from landing on a Friday.
 */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export const STAGE_WORDS: Record<number, string> = {
  0: 'an empty lot',
  1: 'a foundation',
  2: 'walls up',
  3: 'a roof on',
  4: 'lights on',
}

/** Plain-text version of everything the scene shows for one plot. */
export function describePlot(plot: Plot): string {
  const parts: string[] = []
  if (plot.completedShifts === 0) {
    parts.push('No shifts logged yet')
  } else {
    parts.push(
      `${numberWord(plot.completedShifts)} ${plural(
        plot.completedShifts,
        'shift',
        'shifts',
      )} covered`,
    )
  }
  parts.push(STAGE_WORDS[plot.stage] ?? 'a plot')
  if (plot.hasGarden) parts.push('a garden')
  if (plot.quietness > 0.35 && plot.lastActiveAt) {
    parts.push(`quiet since ${shortDate(plot.lastActiveAt)}`)
  } else if (plot.lastActiveAt) {
    parts.push(`last here ${shortDate(plot.lastActiveAt)}`)
  }
  return `${parts.join(', ')}.`
}

/**
 * The forecourt sentence, matching the phrasing the digest uses for the same
 * shift so the two surfaces never word it differently. design.md section 7:
 * plain verbs, sentence case, no drama about a gap.
 */
export function describeShift(shift: Shift): string {
  const when = `${shift.slot} on ${shortDate(shift.startsAt)}`
  if (shift.short === 0) {
    return `${when} is covered. ${numberWord(shift.committed)} ${plural(
      shift.committed,
      'person',
      'people',
    )} coming.`
  }
  return `${when} is short ${numberWord(shift.short)} ${plural(
    shift.short,
    'person',
    'people',
  )}. ${numberWord(shift.committed)} of ${numberWord(
    shift.minimum,
  )} committed so far.`
}


// ------------------------------------------------------------------ tiles

/**
 * Where the streets run, in tile coordinates.
 *
 * Both the carriageway and the lots come out of layoutPlots, so anything that
 * needs to line up with a street asks here rather than recomputing the grid —
 * that duplication is exactly what put the cross street a whole lot away from
 * its gap the first time round.
 */
export interface StreetGrid {
  /** Tile centres along the vertical street. */
  vertical: number[]
  /** Tile centres along the horizontal street. */
  horizontal: number[]
  /** Tile centres along the avenue in front of the block. */
  avenue: number[]
  avenueZ: number
}

export function streetGrid(layout: BlockLayout): StreetGrid {
  const halfW = layout.width / 2 + LOT * 1.5
  const halfD = layout.depth / 2 + LOT * 1.5
  const avenueZ = layout.foodBank.z + LOT * 1.6

  const line = (from: number, to: number) => {
    const out: number[] = []
    for (let v = Math.ceil(from / LOT) * LOT; v <= to; v += LOT) out.push(v)
    return out
  }

  return {
    vertical: line(-halfD, halfD),
    horizontal: line(-halfW, halfW),
    avenue: line(-halfW, halfW),
    avenueZ,
  }
}
