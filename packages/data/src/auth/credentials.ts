/**
 * Registration and password verification.
 *
 * Auth.js owns *sessions*; it does not own sign-up, and its Credentials
 * provider deliberately has no opinion about how a password is stored. So the
 * two things it cannot do — creating the pilot, and checking the password
 * without leaking who exists — live here, and `authorize()` calls in.
 */

import { dummyHash, hashPassword, verifyPassword } from './hash'
import { createPilot, findPilot } from '../repositories/pilots'

import type { Database } from '../client'
import type { Pilot } from '../repositories/pilots'


export type CredentialResult =
  | { ok: true; pilot: Pilot } |
  { ok: false; reason: 'taken' | 'invalid' | 'malformed' }

// Letters, digits, dash and underscore. Names appear on nameplates and in a
//  kill feed, so control characters and lookalike whitespace are out.
const USERNAME = /^[A-Za-z0-9_-]{3,24}$/

const MIN_PASSWORD = 8
const MAX_PASSWORD = 200

export function validCredentials (username: unknown, password: unknown): boolean {
  return typeof username === 'string' &&
    typeof password === 'string' &&
    USERNAME.test(username) &&
    password.length >= MIN_PASSWORD &&
    password.length <= MAX_PASSWORD
}

export async function registerPilot (db: Database, username: string, password: string): Promise<CredentialResult> {
  if (!validCredentials(username, password))
    return { ok: false, reason: 'malformed' }

  const pilot = await createPilot(db, username, await hashPassword(password))
  return pilot ? { ok: true, pilot } : { ok: false, reason: 'taken' }
}

export async function authenticatePilot (db: Database, username: string, password: string): Promise<CredentialResult> {
  if (!validCredentials(username, password))
    return { ok: false, reason: 'malformed' }

  const found = await findPilot(db, username)

  // Verify against a dummy hash when the account does not exist, so a missing
  // username and a wrong password take the same time to answer. Otherwise the
  // response time enumerates who is registered.
  const hash  = found?.passwordHash ?? await dummyHash()
  const valid = await verifyPassword(password, hash)

  if (!found || !valid)
    return { ok: false, reason: 'invalid' }

  return { ok: true, pilot: { id: found.id, username: found.username, createdAt: found.createdAt }}
}
