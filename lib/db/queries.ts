import type { InValue } from '@libsql/client'
import { db } from './client'
import type {
  EventRecord,
  EventType,
  Reflection,
  ReflectionKind,
  Volunteer,
} from '@/lib/types'

/**
 * Thin query module. Raw SQL on purpose — architecture.md section 3.2 says not
 * to spend time on an ORM decision, and the query surface here is small.
 */

// --- row mapping -----------------------------------------------------------

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toEvent(row: any): EventRecord {
  return {
    id: Number(row.id),
    ts: String(row.ts),
    type: String(row.type) as EventType,
    volunteerId: row.volunteer_id === null ? null : String(row.volunteer_id),
    shiftId: row.shift_id === null ? null : String(row.shift_id),
    payload: parseJson<Record<string, unknown>>(row.payload, {}),
    importance: Number(row.importance),
  }
}

function toVolunteer(row: any): Volunteer {
  return {
    id: String(row.id),
    name: String(row.name),
    slackHandle: row.slack_handle === null ? null : String(row.slack_handle),
    joinedAt: String(row.joined_at),
    preferredSlots: parseJson<string[]>(row.preferred_slots, []),
  }
}

function toReflection(row: any): Reflection {
  return {
    id: Number(row.id),
    ts: String(row.ts),
    kind: String(row.kind) as ReflectionKind,
    text: String(row.text),
    sourceEventIds: parseJson<number[]>(row.source_event_ids, []),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// --- reads -----------------------------------------------------------------

export async function listVolunteers(): Promise<Volunteer[]> {
  const result = await db().execute('SELECT * FROM volunteers ORDER BY name')
  return result.rows.map(toVolunteer)
}

export async function listEvents(limit = 500): Promise<EventRecord[]> {
  const result = await db().execute({
    sql: 'SELECT * FROM events ORDER BY ts ASC, id ASC LIMIT ?',
    args: [limit],
  })
  return result.rows.map(toEvent)
}

export async function countEvents(): Promise<number> {
  const result = await db().execute('SELECT COUNT(*) AS n FROM events')
  return Number(result.rows[0]?.n ?? 0)
}

export async function getEventsByIds(ids: number[]): Promise<EventRecord[]> {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  const result = await db().execute({
    sql: `SELECT * FROM events WHERE id IN (${placeholders}) ORDER BY id ASC`,
    args: ids,
  })
  return result.rows.map(toEvent)
}

/**
 * Recent events, newest first. The reflection job's batch bound lives here —
 * architecture.md section 3.4 requires it stay bounded from the first commit,
 * not as a later fix once it times out in production.
 */
export async function recentEvents(limit = 100): Promise<EventRecord[]> {
  const result = await db().execute({
    sql: 'SELECT * FROM events ORDER BY ts DESC, id DESC LIMIT ?',
    args: [limit],
  })
  return result.rows.map(toEvent)
}

/**
 * Simple retrieval, per architecture.md section 3.3: filter by relevance,
 * sort by recency, cap at N. The full recency+importance+relevance scoring
 * function is stretch S2 and deliberately not here.
 */
export async function queryEvents(filter: {
  volunteerId?: string
  shiftId?: string
  slot?: string
  types?: EventType[]
  limit?: number
}): Promise<EventRecord[]> {
  const where: string[] = []
  const args: InValue[] = []

  if (filter.volunteerId) {
    where.push('volunteer_id = ?')
    args.push(filter.volunteerId)
  }
  if (filter.shiftId) {
    where.push('shift_id = ?')
    args.push(filter.shiftId)
  }
  if (filter.slot) {
    // Slot lives in the JSON payload; shift ids are slot-prefixed by the seed.
    where.push("json_extract(payload, '$.slot') = ?")
    args.push(filter.slot)
  }
  if (filter.types?.length) {
    where.push(`type IN (${filter.types.map(() => '?').join(',')})`)
    args.push(...filter.types)
  }

  args.push(filter.limit ?? 50)

  const result = await db().execute({
    sql: `SELECT * FROM events
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
          ORDER BY ts DESC, id DESC
          LIMIT ?`,
    args,
  })
  return result.rows.map(toEvent)
}

export async function listReflections(limit = 20): Promise<Reflection[]> {
  const result = await db().execute({
    sql: 'SELECT * FROM reflections ORDER BY ts DESC, id DESC LIMIT ?',
    args: [limit],
  })
  return result.rows.map(toReflection)
}

// --- writes ----------------------------------------------------------------

export interface NewEvent {
  ts?: string
  type: EventType
  volunteerId?: string | null
  shiftId?: string | null
  payload?: Record<string, unknown>
  importance?: number
}

export async function insertEvent(event: NewEvent): Promise<number> {
  const result = await db().execute({
    sql: `INSERT INTO events (ts, type, volunteer_id, shift_id, payload, importance)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      event.ts ?? new Date().toISOString(),
      event.type,
      event.volunteerId ?? null,
      event.shiftId ?? null,
      JSON.stringify(event.payload ?? {}),
      event.importance ?? 3,
    ],
  })
  return Number(result.lastInsertRowid)
}

export interface NewReflection {
  ts?: string
  kind: ReflectionKind
  text: string
  sourceEventIds: number[]
}

export async function insertReflection(
  reflection: NewReflection,
): Promise<number> {
  const result = await db().execute({
    sql: `INSERT INTO reflections (ts, kind, text, source_event_ids)
          VALUES (?, ?, ?, ?)`,
    args: [
      reflection.ts ?? new Date().toISOString(),
      reflection.kind,
      reflection.text,
      JSON.stringify(reflection.sourceEventIds),
    ],
  })
  return Number(result.lastInsertRowid)
}
