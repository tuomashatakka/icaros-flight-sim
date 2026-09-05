/**
 * One schema, three drivers, chosen by who is asking.
 *
 * - `neon-http` — Vercel route handlers. Every query is its own HTTP request,
 *   so there is no pool to leak across lambda invocations and nothing to close.
 *   It cannot do interactive transactions; use `db.batch()` where the old
 *   hand-written code used `sql.transaction([...])`.
 * - `neon-ws` — the game server, which is one long-lived Bun process and would
 *   rather pay the WebSocket handshake once than an HTTP round trip per query.
 *   Full transactions.
 * - `pglite` — tests and offline development. Real Postgres compiled to WASM,
 *   in-process, so it speaks the *same dialect* as Neon. That is the whole
 *   point: the old SQLite adapter forced a shared contract test to prove three
 *   implementations agreed, and this one cannot disagree.
 *
 * Nothing above this module names a driver. Repositories take `Database`.
 */

import { neon, neonConfig, Pool } from '@neondatabase/serverless'
import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http'
import { drizzle as drizzleWs } from 'drizzle-orm/neon-serverless'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'

import * as schema from './schema'

import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'


/**
 * The driver-agnostic handle every repository is written against. Naming the
 * base class rather than a union keeps the query builder's types intact — a
 * union of the three concrete database types would collapse every method
 * signature into an unusable intersection.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>

export type DatabaseDriver = 'neon-http' | 'neon-ws' | 'pglite'

export type DatabaseOptions = {
  driver?:           DatabaseDriver;
  connectionString?: string;
}

export type DatabaseHandle = {
  db:     Database;
  driver: DatabaseDriver;
  close:  () => Promise<void>;
}

export function connectionStringOf (options: DatabaseOptions = {}): string | undefined {
  return options.connectionString ?? process.env.DATABASE_URL ?? undefined
}

export function resolveDriver (options: DatabaseOptions = {}): DatabaseDriver {
  if (options.driver)
    return options.driver

  const named = process.env.DB_DRIVER
  if (named) {
    if (named !== 'neon-http' && named !== 'neon-ws' && named !== 'pglite')
      throw new Error(`DB_DRIVER must be neon-http, neon-ws or pglite; got ${named}`)
    return named
  }

  // No connection string is not an error — it means "there is no Neon here",
  // which is the normal state of a test run and of a laptop on a plane.
  return connectionStringOf(options) ? 'neon-http' : 'pglite'
}

/** Never prints the password: this ends up in boot logs. */
export function describeDatabase (options: DatabaseOptions = {}): string {
  const driver = resolveDriver(options)
  if (driver === 'pglite')
    return 'pglite (in-process)'

  const url = connectionStringOf(options)
  if (!url)
    return `${driver} (no DATABASE_URL)`

  try {
    const { host, pathname } = new URL(url)
    return `${driver} ${host}${pathname}`
  }
  catch {
    return `${driver} (unparseable DATABASE_URL)`
  }
}

export async function openDatabase (options: DatabaseOptions = {}): Promise<DatabaseHandle> {
  const driver = resolveDriver(options)

  if (driver === 'pglite') {
    // Imported lazily so the WASM payload never lands in a Vercel bundle that
    // is only ever going to talk to Neon.
    const { PGlite } = await import('@electric-sql/pglite')
    const client     = new PGlite()
    const db         = drizzlePglite(client, { schema }) as unknown as Database
    return { db,
      driver,
      close: async () => {
        await client.close()
      } }
  }

  const url = connectionStringOf(options)
  if (!url)
    throw new Error(`driver ${driver} needs DATABASE_URL`)

  if (driver === 'neon-ws') {
    // Bun ships a global WebSocket, and so does Node 22 — but the driver only
    // reaches for `neonConfig.webSocketConstructor`, so it has to be handed one
    // explicitly or it fails at first query rather than at boot.
    neonConfig.webSocketConstructor ??= globalThis.WebSocket

    const pool = new Pool({ connectionString: url })
    const db   = drizzleWs(pool, { schema }) as unknown as Database
    return { db,
      driver,
      close: async () => {
        await pool.end()
      } }
  }

  const db = drizzleHttp(neon(url), { schema }) as unknown as Database
  return { db, driver, close: async () => {} }
}
