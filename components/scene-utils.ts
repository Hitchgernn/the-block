import * as THREE from 'three'
import type { Plot } from '@/lib/types'

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

export const LOT = 3.0
export const ROAD_GAP = 1.6
const COLS = 6

export interface Placement {
  plot: Plot
  x: number
  z: number
}

/** A grid of lots split by one cross street each way, then centred. */
export function layoutPlots(plots: Plot[]): {
  placements: Placement[]
  width: number
  depth: number
} {
  const rows = Math.max(1, Math.ceil(plots.length / COLS))
  const cols = Math.min(COLS, plots.length)
  const colBreak = Math.floor(COLS / 2)
  const rowBreak = Math.max(1, Math.floor(rows / 2))

  const width = cols * LOT + ROAD_GAP
  const depth = rows * LOT + ROAD_GAP

  const placements = plots.map((plot, index) => {
    const col = index % COLS
    const row = Math.floor(index / COLS)
    const x = col * LOT + (col >= colBreak ? ROAD_GAP : 0) - width / 2 + LOT / 2
    const z = row * LOT + (row >= rowBreak ? ROAD_GAP : 0) - depth / 2 + LOT / 2
    return { plot, x, z }
  })

  return { placements, width, depth }
}

export function roadLines(width: number, depth: number) {
  const colBreak = Math.floor(COLS / 2)
  const rowBreak = 1
  return {
    x: colBreak * LOT + ROAD_GAP / 2 - width / 2,
    z: rowBreak * LOT + ROAD_GAP / 2 - depth / 2,
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
