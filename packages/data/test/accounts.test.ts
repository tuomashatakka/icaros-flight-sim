/**
 * Accounts.
 *
 * This used to live in `test-bun/`, because `Bun.password` was a runtime
 * builtin that vitest's node process could not provide. Hashing is scrypt from
 * `node:crypto` now — the same code runs on both hosts — so the file runs with
 * the rest of the suite, which is where AGENTS.md says a test belongs when it
 * does not actually need the runtime.
 */
import { describe, expect, it } from 'vitest'
import { login, register, validCredentials } from '../src/auth/accounts'
import { verifyPassword } from '../src/auth/hash'
import { MemoryStore } from '../src/store/memory'


const GOOD = 'correct-horse'

describe('validCredentials', () => {
  it('accepts an ordinary name and password', () => {
    expect(validCredentials('Maverick', GOOD)).toBe(true)
    expect(validCredentials('ice_man-2', GOOD)).toBe(true)
  })

  it('rejects names that would not render as a nameplate', () => {
    // Names appear over ships and in a kill feed, so anything that could be
    // invisible, look like another name, or break layout is out.
    for (const bad of [ '', 'ab', 'a'.repeat(25), 'has space', 'emoji🙂', 'semi;colon', '‮reversed' ])
      expect(validCredentials(bad, GOOD), bad).toBe(false)
  })

  it('rejects a password that is too short or absurdly long', () => {
    expect(validCredentials('Maverick', 'short')).toBe(false)
    expect(validCredentials('Maverick', 'x'.repeat(500))).toBe(false)
  })
})

describe('register', () => {
  it('creates an account and signs it in', async () => {
    const store  = new MemoryStore()
    const result = await register(store, 'Maverick', GOOD)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.account.username).toBe('Maverick')
      expect(await store.resolveSession(result.token)).toMatchObject({ username: 'Maverick' })
    }
  })

  it('refuses a name already taken, in any casing', async () => {
    // `Pilot` and `pilot` both existing would make a roster ambiguous.
    const store = new MemoryStore()
    await register(store, 'Maverick', GOOD)

    const again = await register(store, 'MAVERICK', GOOD)
    expect(again).toEqual({ ok: false, reason: 'taken' })
  })

  it('never stores the password itself', async () => {
    const store = new MemoryStore()
    await register(store, 'Maverick', GOOD)

    const found = await store.findAccount('Maverick')
    expect(found?.passwordHash).not.toContain(GOOD)
    expect(await verifyPassword(GOOD, found!.passwordHash)).toBe(true)
  })
})

describe('login', () => {
  it('signs in with the right password', async () => {
    const store = new MemoryStore()
    await register(store, 'Maverick', GOOD)

    const result = await login(store, 'Maverick', GOOD)
    expect(result.ok).toBe(true)
  })

  it('is case-insensitive on the name', async () => {
    const store = new MemoryStore()
    await register(store, 'Maverick', GOOD)
    expect((await login(store, 'mAvErIcK', GOOD)).ok).toBe(true)
  })

  it('refuses a wrong password', async () => {
    const store = new MemoryStore()
    await register(store, 'Maverick', GOOD)
    expect(await login(store, 'Maverick', 'wrong-password')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('answers a missing account exactly as it answers a wrong password', async () => {
    // Otherwise the response enumerates who is registered.
    const store = new MemoryStore()
    await register(store, 'Maverick', GOOD)

    expect(await login(store, 'Nobody', GOOD)).toEqual({ ok: false, reason: 'invalid' })
    expect(await login(store, 'Maverick', 'wrong-password')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('issues a fresh session each time', async () => {
    const store = new MemoryStore()
    await register(store, 'Maverick', GOOD)

    const a = await login(store, 'Maverick', GOOD)
    const b = await login(store, 'Maverick', GOOD)
    expect(a.ok && b.ok && a.token !== b.token).toBe(true)
  })
})

describe('sessions', () => {
  it('stops resolving once expired', async () => {
    const store   = new MemoryStore()
    const account = await store.createAccount('Maverick', 'hash')
    const session = await store.createSession(account!.id, -1)

    expect(await store.resolveSession(session.token)).toBeNull()
  })

  it('stops resolving once dropped', async () => {
    const store   = new MemoryStore()
    const account = await store.createAccount('Maverick', 'hash')
    const session = await store.createSession(account!.id, 60_000)

    await store.dropSession(session.token)
    expect(await store.resolveSession(session.token)).toBeNull()
  })
})

describe('stats', () => {
  it('accumulates across matches', async () => {
    const store   = new MemoryStore()
    const account = await store.createAccount('Maverick', 'hash')

    for (const id of [ 'm1', 'm2' ]) {
      await store.recordMatchStart({ id, mode: 'ctf', arena: 'apex', startedAt: 0, endedAt: null, winner: null, scores: {}})
      await store.recordMatchPlayers([
        { matchId: id, accountId: account!.id, name: 'Maverick', team: 'red', kills: 3, deaths: 1, captures: 2 },
        { matchId: id, accountId: null, name: 'Bot 1', team: 'blue', kills: 0, deaths: 3, captures: 0 },
      ])
    }

    expect(await store.statsFor(account!.id)).toEqual({ matches: 2, kills: 6, deaths: 2, captures: 4 })
  })

  it('is empty for someone who has never played', async () => {
    const store   = new MemoryStore()
    const account = await store.createAccount('Maverick', 'hash')
    expect(await store.statsFor(account!.id)).toEqual({ matches: 0, kills: 0, deaths: 0, captures: 0 })
  })
})
