/**
 * The database a route handler talks to.
 *
 * Server-only, and the directory name is the signal: nothing under
 * `lib/server/` may be imported from a client component, because it reaches a
 * database with a connection string in it.
 *
 * Memoised per instance rather than per request. A warm Vercel lambda serves
 * many requests, and the Neon HTTP driver holds no connection, so there is
 * nothing to leak by sharing it — and nothing to close either.
 */

import { openDatabase } from 'Ð'

import type { Database } from 'Ð'


let opened: Promise<Database> | null = null

export function serverDb (): Promise<Database> {
  // Read lazily, not at module scope: tests set DB_DRIVER before calling a
  // handler, and module scope would make import order decide the answer.
  opened ??= openDatabase().then(handle => handle.db)
  return opened
}
