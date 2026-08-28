/**
 * The SQLite `Store`.
 *
 * Runs under `bun test` because it imports `bun:sqlite`. Everything the rest of
 * the server does with persistence goes through `MemoryStore` in the vitest
 * suite; this file is here to prove the two implementations actually agree,
 * because the interface only helps if they do.
 */
import { describe, expect, it } from 'bun:test'
import { MemoryStore } from '../src/store/memory'
import { SqliteStore } from '../src/store/sqlite'
import type { Store } from '../src/store/store'


const implementations: Array<[string, () => Store]> = [
  [ 'MemoryStore', () => new MemoryStore() ],
  [ 'SqliteStore', () => new SqliteStore(':memory:') ],
]

for (const [ name, make ] of implementations)
  describe(name, () => {
    it('round-trips an account', async () => {
      const store   = make()
      const created = await store.createAccount('Maverick', 'hashed')

      expect(created?.username).toBe('Maverick')
      expect((await store.accountById(created!.id))?.username).toBe('Maverick')
      expect((await store.findAccount('MAVERICK'))?.passwordHash).toBe('hashed')
      store.close()
    })

    it('refuses a duplicate name regardless of casing', async () => {
      const store = make()
      await store.createAccount('Maverick', 'a')

      expect(await store.createAccount('maverick', 'b')).toBeNull()
      store.close()
    })

    it('returns null for an unknown account', async () => {
      const store = make()
      expect(await store.findAccount('Nobody')).toBeNull()
      expect(await store.accountById('not-an-id')).toBeNull()
      store.close()
    })

    it('resolves a live session and refuses an expired one', async () => {
      const store   = make()
      const account = await store.createAccount('Maverick', 'a')

      const live = await store.createSession(account!.id, 60_000)
      expect((await store.resolveSession(live.token))?.id).toBe(account!.id)

      const dead = await store.createSession(account!.id, -1)
      expect(await store.resolveSession(dead.token)).toBeNull()

      store.close()
    })

    it('forgets a dropped session', async () => {
      const store   = make()
      const account = await store.createAccount('Maverick', 'a')
      const session = await store.createSession(account!.id, 60_000)

      await store.dropSession(session.token)
      expect(await store.resolveSession(session.token)).toBeNull()
      store.close()
    })

    it('records a match and totals its rosters', async () => {
      const store   = make()
      const account = await store.createAccount('Maverick', 'a')

      await store.recordMatchStart({
        id: 'm1', mode: 'ctf', arena: 'apex', startedAt: 1, endedAt: null, winner: null, scores: { red: 0, blue: 0 },
      })
      await store.recordMatchPlayers([
        { matchId: 'm1', accountId: account!.id, name: 'Maverick', team: 'red', kills: 4, deaths: 2, captures: 1 },
        // Guests and bots still get a row, so a roster is complete even when
        // most of it was never signed in.
        { matchId: 'm1', accountId: null, name: 'Bot 1', team: 'blue', kills: 1, deaths: 4, captures: 0 },
      ])
      await store.recordMatchEnd('m1', 99, 'red', { red: 5, blue: 1 })

      expect(await store.statsFor(account!.id)).toEqual({ matches: 1, kills: 4, deaths: 2, captures: 1 })
      store.close()
    })

    it('reports empty stats for someone who has never played', async () => {
      const store   = make()
      const account = await store.createAccount('Maverick', 'a')
      expect(await store.statsFor(account!.id)).toEqual({ matches: 0, kills: 0, deaths: 0, captures: 0 })
      store.close()
    })
  })

describe('SqliteStore durability', () => {
  it('keeps accounts across reopening the same file', async () => {
    // The point of choosing sqlite over memory: a hobby server's whole database
    // is a file, and restarting it must not lose everyone's account.
    const path  = `/tmp/cv-store-${crypto.randomUUID()}.sqlite`
    const first = new SqliteStore(path)
    const made  = await first.createAccount('Maverick', 'hashed')
    first.close()

    const second = new SqliteStore(path)
    expect((await second.findAccount('Maverick'))?.id).toBe(made!.id)
    second.close()
  })
})
