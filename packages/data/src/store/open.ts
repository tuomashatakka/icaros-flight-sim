/**
 * Which `Store` to use, decided from the environment.
 *
 * This reads `process.env` itself rather than taking values from the battle
 * server's `loadConfig()`, because the other consumer is a Next route handler
 * on Vercel, which has no `loadConfig()` — and the two hosts must resolve the
 * same database from the same variables or a token minted by one is invisible
 * to the other.
 *
 * Only `neon` and `memory` are wired here. `sqlite` lives in `packages/server`
 * and is layered on top by its own `openStore`, because `bun:sqlite` cannot be
 * imported from a package that also has to run under Node.
 */

import { MemoryStore } from './memory'
import type { Store } from './store'


export type StoreDriver = 'neon' | 'sqlite' | 'memory'

export type StoreOptions = {
  driver?:           StoreDriver;
  connectionString?: string;
  path?:             string;
}

export const DEFAULT_DB_PATH = './data/battle.sqlite'

const MISSING_URL =
  'STORE_DRIVER=neon needs DATABASE_URL. Set it to a Neon connection string ' +
  '(the Vercel Neon integration injects one), or set STORE_DRIVER=sqlite for a ' +
  'local file or STORE_DRIVER=memory for a throwaway session.'

function envDriver (): StoreDriver | undefined {
  const raw = process.env.STORE_DRIVER?.trim()
  if (!raw)
    return undefined
  if (raw !== 'neon' && raw !== 'sqlite' && raw !== 'memory')
    throw new Error(`STORE_DRIVER must be neon, sqlite or memory, got ${JSON.stringify(raw)}`)
  return raw
}

/**
 * Neon is the default, and in every deployed environment it is also what you
 * get: the Vercel integration injects `DATABASE_URL`, so the second branch is
 * only ever taken on a laptop that has not configured one.
 *
 * The fallback is what keeps `.env.example`'s promise — that nothing needs
 * setting to play locally — true. `sqlite` is offered only when something can
 * actually load it; `next dev` runs on Node, so a route handler falls to
 * `memory` instead.
 */
export function resolveDriver (options: StoreOptions = {}): StoreDriver {
  const explicit = options.driver ?? envDriver()
  if (explicit)
    return explicit

  if (options.connectionString ?? process.env.DATABASE_URL)
    return 'neon'

  return hasBunSqlite() ? 'sqlite' : 'memory'
}

/** `bun:sqlite` is a runtime builtin, so its availability is the runtime's. */
function hasBunSqlite (): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
}

/** One line for a startup log. Reads the environment; opens nothing. */
export function storeDescription (options: StoreOptions = {}): string {
  const driver = resolveDriver(options)
  if (driver === 'sqlite')
    return `sqlite ${options.path ?? process.env.DB_PATH ?? DEFAULT_DB_PATH}`
  if (driver === 'memory')
    return 'in-memory'

  // Never the whole URL: it carries the password, and this line gets pasted
  // into issues.
  const url = options.connectionString ?? process.env.DATABASE_URL ?? ''
  return `neon ${url.replace(/^.*@/, '').split('/')[0] || '(unknown host)'}`
}

export async function openStore (options: StoreOptions = {}): Promise<Store> {
  const driver = resolveDriver(options)

  if (driver === 'memory')
    return new MemoryStore()

  if (driver === 'sqlite')
    throw new Error(
      'the sqlite store lives in packages/server; use its openStore, or set ' +
      'STORE_DRIVER=neon or STORE_DRIVER=memory here'
    )

  const url = options.connectionString ?? process.env.DATABASE_URL
  if (!url)
    throw new Error(MISSING_URL)

  // Dynamic, so a run that never reaches Postgres never loads the driver.
  const { NeonStore } = await import('./neon')
  return new NeonStore(url)
}
