/**
 * Applying migrations.
 *
 * `drizzle-kit generate` writes the SQL; this applies it. Two runners, because
 * the two drivers need different migrators and the WASM one is only ever used
 * by a test that wants a schema without a network.
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import type { Database } from './client'


/** The generated folder, resolved relative to this file rather than the cwd. */
export const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

export async function migrateNeon (connectionString: string): Promise<void> {
  const { neon }    = await import('@neondatabase/serverless')
  const { drizzle } = await import('drizzle-orm/neon-http')
  const { migrate } = await import('drizzle-orm/neon-http/migrator')

  const db = drizzle(neon(connectionString))
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
}

/** Used by tests to bring a fresh in-process Postgres up to the current schema. */
export async function migratePglite (db: Database): Promise<void> {
  const { migrate } = await import('drizzle-orm/pglite/migrator')
  // The pglite migrator wants its own database type; the cast is contained to
  // this one line rather than leaking a driver union through `Database`.
  await migrate(db as never, { migrationsFolder: MIGRATIONS_FOLDER })
}
