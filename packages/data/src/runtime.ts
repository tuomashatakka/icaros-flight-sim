/**
 * The one database this process talks to.
 *
 * Colyseus constructs rooms itself — there is no constructor to hand a
 * dependency to, and `define()`'s default options are merged with whatever a
 * client sent and then used for matchmaking filters, which is no place for a
 * live connection pool. So the server installs the handle at boot and the rooms
 * read it.
 *
 * A process-wide singleton is honest here rather than lazy: this is one Bun
 * process holding one pool, and the alternative — threading a `Database` down
 * through every room type — would be ceremony around a fact that cannot vary.
 *
 * Recording is deliberately best-effort. A match that fails to persist is a
 * lost scoreboard row; a match that *fails* because the scoreboard was
 * unreachable is a room full of people thrown out. `withDatabase` swallows, and
 * says so.
 */

import type { Database } from './client'


let current: Database | null = null

export function setDatabase (db: Database | null): void {
  current = db
}

export function getDatabase (): Database | null {
  return current
}

/**
 * Run a write if there is somewhere to write to.
 *
 * Returns whether it ran, so a caller that wants to know can ask — but nothing
 * in a game loop should care.
 */
export async function withDatabase (
  write: (db: Database) => Promise<unknown>,
  label = 'database write',
): Promise<boolean> {
  if (!current)
    return false

  try {
    await write(current)
    return true
  }
  catch (error) {
    process.stderr?.write?.(`[data] ${label} failed: ${error instanceof Error ? error.message : String(error)}\n`)
    return false
  }
}
