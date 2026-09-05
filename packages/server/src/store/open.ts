/**
 * The battle server's store selection: `@crash-velocity/data`'s, plus SQLite.
 *
 * SQLite cannot live in that package — it imports `bun:sqlite`, and the package
 * also has to run under Node on Vercel — so the third adapter is layered on
 * here, where Bun is guaranteed. Everything else about the decision (which
 * driver, from which variables, with which defaults) stays over there, so the
 * two hosts cannot drift into resolving different databases.
 */

import { DEFAULT_DB_PATH, openStore as openPortableStore, resolveDriver } from '@crash-velocity/data'
import type { Store, StoreOptions } from '@crash-velocity/data'


export async function openStore (options: StoreOptions = {}): Promise<Store> {
  if (resolveDriver(options) !== 'sqlite')
    return openPortableStore(options)

  // Dynamic, so `bun:sqlite` is only loaded when a file is actually wanted.
  const { SqliteStore } = await import('./sqlite')
  return new SqliteStore(options.path ?? process.env.DB_PATH ?? DEFAULT_DB_PATH)
}

/**
 * Apply the Postgres schema at boot, behind `STORE_MIGRATE=1`.
 *
 * Off by default, and never something a Vercel route handler does: those are N
 * uncoordinated lambdas, and concurrent `CREATE INDEX IF NOT EXISTS` on one
 * table is a way to deadlock rather than to bootstrap. A single long-lived
 * process that owns its deployment is the one place this is safe.
 */
export async function migrateIfRequested (options: StoreOptions = {}): Promise<void> {
  if (process.env.STORE_MIGRATE !== '1' || resolveDriver(options) !== 'neon')
    return

  const url = process.env.DATABASE_URL_UNPOOLED ?? options.connectionString ?? process.env.DATABASE_URL
  if (!url)
    return

  const { pushSchema } = await import('@crash-velocity/data/migrate')
  const applied        = await pushSchema(url)
  console.info(`[battle] STORE_MIGRATE applied ${applied.length} schema statements`)
}
