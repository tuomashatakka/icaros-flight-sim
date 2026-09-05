/**
 * Accounts, kept deliberately small.
 *
 * This is not an identity provider. It exists so a returning player keeps a
 * name and a record, and nothing more: no email, no recovery, no roles. Guests
 * play without any of it — signing in must never be a gate in front of the
 * game, only a way to be remembered by it.
 *
 * Hashing lives in `./hash`: scrypt from `node:crypto`, not `Bun.password`.
 * This module runs both in the battle server and in a Next route handler on
 * Vercel's Node runtime, and only one of those two has `Bun`.
 */

import { dummyHash, hashPassword, verifyPassword } from './hash'
import { SESSION_TTL_MS } from '../store/store'
import type { Account, Store } from '../store/store'


export type AuthResult =
  | { ok: true; account: Account; token: string } |
  { ok: false; reason: 'taken' | 'invalid' | 'malformed' }

// Letters, digits, dash and underscore. Names appear on nameplates and in a
//  kill feed, so control characters and lookalike whitespace are out.
const USERNAME = /^[A-Za-z0-9_-]{3,24}$/

const MIN_PASSWORD = 8

export function validCredentials (username: string, password: string): boolean {
  return USERNAME.test(username) && password.length >= MIN_PASSWORD && password.length <= 200
}

export async function register (store: Store, username: string, password: string): Promise<AuthResult> {
  if (!validCredentials(username, password))
    return { ok: false, reason: 'malformed' }

  const account = await store.createAccount(username, await hashPassword(password))
  if (!account)
    return { ok: false, reason: 'taken' }

  const session = await store.createSession(account.id, SESSION_TTL_MS)
  return { ok: true, account, token: session.token }
}

export async function login (store: Store, username: string, password: string): Promise<AuthResult> {
  if (!validCredentials(username, password))
    return { ok: false, reason: 'malformed' }

  const found = await store.findAccount(username)

  // Verify against a dummy hash when the account does not exist, so a missing
  // username and a wrong password take the same time to answer. Otherwise the
  // response time enumerates who is registered.
  const hash  = found?.passwordHash ?? await dummyHash()
  const valid = await verifyPassword(password, hash)

  if (!found || !valid)
    return { ok: false, reason: 'invalid' }

  const session = await store.createSession(found.id, SESSION_TTL_MS)
  return {
    ok:      true,
    account: { id: found.id, username: found.username, createdAt: found.createdAt },
    token:   session.token,
  }
}
