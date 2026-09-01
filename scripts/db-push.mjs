// Apply lib/db/schema.sql to whatever TURSO_DATABASE_URL points at.
// Local:  node scripts/db-push.mjs
// Turso:  node --env-file=.env.local scripts/db-push.mjs

import { createClient } from '@libsql/client'
import { readFileSync, mkdirSync } from 'node:fs'

const url = process.env.TURSO_DATABASE_URL ?? 'file:.data/local.db'
if (url.startsWith('file:')) mkdirSync('.data', { recursive: true })

const client = createClient(
  url.startsWith('file:') ? { url } : { url, authToken: process.env.TURSO_AUTH_TOKEN },
)

// Strip comment lines first. Splitting on ';' and then dropping chunks that
// begin with '--' silently eats any statement preceded by a comment.
const statements = readFileSync('lib/db/schema.sql', 'utf8')
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)

for (const statement of statements) await client.execute(statement)

console.log(`schema applied to ${url} (${statements.length} statements)`)
