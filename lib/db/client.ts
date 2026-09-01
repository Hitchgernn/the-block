import { createClient, type Client } from '@libsql/client'

/**
 * Single libSQL client.
 *
 * Production is Turso over HTTP — architecture.md section 3.2 is explicit that
 * SQLite-on-disk cannot work on serverless, where the filesystem is ephemeral.
 * Locally, a `file:` URL uses the identical SQL dialect, so nothing about the
 * schema or queries changes between the two.
 */

let client: Client | undefined

export function db(): Client {
  if (client) return client

  const url = process.env.TURSO_DATABASE_URL ?? 'file:.data/local.db'
  const authToken = process.env.TURSO_AUTH_TOKEN

  client = createClient(
    url.startsWith('file:') ? { url } : { url, authToken },
  )

  return client
}

/** True when running against a local file rather than Turso. */
export function isLocalDb(): boolean {
  return (process.env.TURSO_DATABASE_URL ?? 'file:').startsWith('file:')
}
