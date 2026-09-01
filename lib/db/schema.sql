-- The Block — schema
-- Dialect: SQLite / libSQL (Turso). See architecture.md section 3.2.
--
-- Principle 3: append-only events, nothing is mutated, current state is derived.
-- Points, streaks, plot growth stage and reliability are NEVER stored here.
-- They are computed from `events` on read by lib/db/derive.ts, which is what
-- guarantees the 3D view cannot drift from reality.

CREATE TABLE IF NOT EXISTS volunteers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  slack_handle    TEXT,
  joined_at       TEXT NOT NULL,           -- ISO-8601 UTC
  preferred_slots TEXT NOT NULL DEFAULT '[]'  -- JSON array of slot labels
);

-- The only table the agent loop writes to.
CREATE TABLE IF NOT EXISTS events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts           TEXT NOT NULL,              -- ISO-8601 UTC
  type         TEXT NOT NULL,              -- see EventType in lib/types.ts
  volunteer_id TEXT REFERENCES volunteers(id),
  shift_id     TEXT,
  payload      TEXT NOT NULL DEFAULT '{}', -- JSON object
  importance   INTEGER NOT NULL DEFAULT 3  -- 1..5, used by retrieval
);

CREATE INDEX IF NOT EXISTS idx_events_ts        ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_type      ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_volunteer ON events(volunteer_id);
CREATE INDEX IF NOT EXISTS idx_events_shift     ON events(shift_id);

-- Written only by the reflection job.
CREATE TABLE IF NOT EXISTS reflections (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  ts               TEXT NOT NULL,
  kind             TEXT NOT NULL,          -- 'pattern' | 'person' | 'risk'
  text             TEXT NOT NULL,
  source_event_ids TEXT NOT NULL DEFAULT '[]'  -- JSON array of event ids
);

CREATE INDEX IF NOT EXISTS idx_reflections_ts ON reflections(ts);
