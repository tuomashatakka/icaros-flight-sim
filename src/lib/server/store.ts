/**
 * The `Store` a route handler talks to.
 *
 * Server-only, and the directory name is the signal: nothing under
 * `lib/server/` may be imported from a client component, because it reaches a
 * database with a connection string in it.
 *
 * Memoised per instance rather than per request. A warm Vercel lambda serves
 * many requests, and `openStore()` reads the environment and dynamically
 * imports a driver each time it is called; the Neon HTTP driver holds no
 * connection, so there is nothing to leak by sharing it.
 */

import { openStore } from '@crash-velocity/data'
import type { Store } from '@crash-velocity/data'


let opened: Promise<Store> | null = null

export function serverStore (): Promise<Store> {
  // Read lazily, not at module scope: tests set STORE_DRIVER before calling a
  // handler, and module scope would make import order decide the answer.
  opened ??= openStore()
  return opened
}
