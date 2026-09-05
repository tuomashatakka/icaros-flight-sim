/**
 * Pilots — accounts, kept deliberately small.
 *
 * This is not an identity provider. It exists so a returning player keeps a
 * name and a record, and nothing more: no email, no recovery, no roles. Guests
 * play without any of it — signing in must never be a gate in front of the
 * game, only a way to be remembered by it.
 */

import { eq, sql } from 'drizzle-orm'

import { users } from '../schema'

import type { Database } from '../client'


export type Pilot = {
  id:        string;
  username:  string;
  createdAt: number;
}

export type PilotWithSecret = Pilot & { passwordHash: string | null }

const publicColumns = {
  id:        users.id,
  username:  users.username,
  createdAt: users.createdAt,
}

/**
 * Fails — returns null — when the username is taken.
 *
 * The conflict target is left off on purpose: the only unique constraint that
 * can fire is the functional `lower(username)` index, and naming a functional
 * index in `ON CONFLICT` means restating the expression exactly. Zero rows back
 * therefore means "that name is taken", which is the only reason it can be zero.
 */
export async function createPilot (db: Database, username: string, passwordHash: string): Promise<Pilot | null> {
  const rows = await db
    .insert(users)
    .values({ id: crypto.randomUUID(), name: username, username, passwordHash, createdAt: Date.now() })
    .onConflictDoNothing()
    .returning(publicColumns)

  return rows[0] ?? null
}

/**
 * The `::text` cast is load-bearing: without it Postgres can resolve `lower()`
 * against `lower(anyrange)` for a parameter of unknown type, which both fails
 * to match the expression index and, on a bad day, errors.
 */
export async function findPilot (db: Database, username: string): Promise<PilotWithSecret | null> {
  const rows = await db
    .select({ ...publicColumns, passwordHash: users.passwordHash })
    .from(users)
    .where(sql `lower(${users.username}) = lower(${username}::text)`)
    .limit(1)

  return rows[0] ?? null
}

export async function pilotById (db: Database, id: string): Promise<Pilot | null> {
  const rows = await db.select(publicColumns).from(users)
    .where(eq(users.id, id))
    .limit(1)
  return rows[0] ?? null
}
