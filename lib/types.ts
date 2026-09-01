/**
 * The Block — frozen contract.
 *
 * Every API response shape lives here. This file is what makes the frontend,
 * the agent and the data layer buildable in parallel: with one language the
 * contract is enforced by the compiler instead of living in a README.
 *
 * Changing a type here is a cross-cutting change. Do it deliberately.
 */

// ---------------------------------------------------------------------------
// Domain primitives
// ---------------------------------------------------------------------------

/** Append-only event log vocabulary. See architecture.md section 3.2. */
export type EventType =
  | 'shift_opened'
  | 'ask_sent'
  | 'ask_accepted'
  | 'ask_declined'
  | 'shift_completed'
  | 'no_show'
  | 'shift_short'
  | 'agent_reasoning'

/** Reflection categories produced by the reflection job. */
export type ReflectionKind = 'pattern' | 'person' | 'risk'

/**
 * A recurring slot label, e.g. "Saturday 9am". Slots are the unit the agent
 * reasons about — patterns live at slot level, not individual shift level.
 */
export type SlotLabel = string

export interface Volunteer {
  id: string
  name: string
  slackHandle: string | null
  joinedAt: string
  preferredSlots: SlotLabel[]
}

export interface EventRecord {
  id: number
  ts: string
  type: EventType
  volunteerId: string | null
  shiftId: string | null
  payload: Record<string, unknown>
  importance: number
}

export interface Reflection {
  id: number
  ts: string
  kind: ReflectionKind
  text: string
  sourceEventIds: number[]
}

// ---------------------------------------------------------------------------
// Event payload contracts
//
// `payload` is free-form JSON in the schema, but these shapes are written by
// the agent loop and read by the digest. They are part of the frozen contract:
// if the loop stops writing `reasoning`, the coordinator surface silently loses
// the thing that proves the agent decided rather than broadcast.
// ---------------------------------------------------------------------------

/** Written with every `shift_opened`, `ask_*`, `shift_completed`, `no_show`. */
export interface SlotPayload {
  slot: SlotLabel
  [key: string]: unknown
}

/** Written with `ask_sent`, one event per volunteer actually contacted. */
export interface AskSentPayload extends SlotPayload {
  volunteerName: string
  /** The message the agent wrote for this specific person. */
  message: string
  /** Why this person, in the model's words. */
  rationale: string
  /** False when Slack was unavailable and the ask went to the outbox. */
  delivered: boolean
}

/** Written once per loop run, capturing the decide step. Demo asset. */
export interface AgentReasoningPayload extends SlotPayload {
  /** The model's account of how it read the gap and chose people. */
  reasoning: string
  /** Volunteer ids it chose. */
  chose: string[]
  /** Volunteer ids it considered and passed over, if it said so. */
  passedOver?: string[]
  /** How many events were retrieved into the decide prompt. */
  contextEventCount: number
}

// ---------------------------------------------------------------------------
// Derived state — computed from events, never stored
// ---------------------------------------------------------------------------

/**
 * Plot growth stage. Additive only: a plot never regresses, and inaction is
 * never a visual penalty. See design.md section 4.
 *
 * 0 empty lot · 1 foundation · 2 walls · 3 roof · 4 lit
 */
export type GrowthStage = 0 | 1 | 2 | 3 | 4

export interface Plot {
  volunteerId: string
  name: string
  stage: GrowthStage
  completedShifts: number
  points: number
  /** Consecutive weeks with at least one completed shift. */
  streakWeeks: number
  /** Stage 5 in design.md: additive garden detail at 4+ week streak. */
  hasGarden: boolean
  /**
   * 0 = just active, 1 = long quiet. Dims windows from --lamp toward
   * --lamp-soft. Never reaches full dark and never regresses a stage.
   */
  quietness: number
  lastActiveAt: string | null
}

/** A concrete dated instance of a slot. */
export interface Shift {
  id: string
  slot: SlotLabel
  startsAt: string
  minimum: number
  committed: number
  /** minimum - committed, floored at 0. */
  short: number
}

export interface ActivityItem {
  eventId: number
  ts: string
  /** Pre-rendered sentence, copy rules per design.md section 7. */
  text: string
}

// ---------------------------------------------------------------------------
// API responses
// ---------------------------------------------------------------------------

/** GET /api/state — everything the 3D scene needs in one call. */
export interface StateResponse {
  generatedAt: string
  plots: Plot[]
  upcomingShifts: Shift[]
  recentActivity: ActivityItem[]
  totals: {
    volunteers: number
    completedShifts: number
    litPlots: number
  }
}

/** One thing the agent did, with the reasoning that produced it. */
export interface AgentAction {
  eventId: number
  ts: string
  shiftId: string | null
  slot: SlotLabel | null
  /** Volunteers actually asked, by name. Never a broadcast. */
  askedNames: string[]
  /** The model's own account of why these people. Demo asset. */
  reasoning: string | null
}

/** A reflection plus the raw events behind it, for on-camera provenance. */
export interface ReflectionWithSources extends Reflection {
  sources: EventRecord[]
}

/** GET /api/digest — the coordinator surface. See design.md section 6. */
export interface DigestResponse {
  generatedAt: string
  /** 1. What the agent noticed. Most recent first. */
  noticed: ReflectionWithSources[]
  /** 2. What the agent did. */
  did: AgentAction[]
  /** 3. What's still open — gaps the agent could not fill. */
  stillOpen: Shift[]
}

/** GET /api/events — raw log, shown on camera to prove provenance. */
export interface EventsResponse {
  generatedAt: string
  events: EventRecord[]
  total: number
}

/** POST /api/trigger/loop and /api/trigger/reflect. */
export interface TriggerResponse {
  ok: boolean
  elapsedMs: number
  /** Event ids written by this run, so the UI can highlight what changed. */
  writtenEventIds: number[]
  summary: string
  error?: string
}
