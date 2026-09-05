/**
 * What every `Store` implementation has to answer, identically.
 *
 * Shared rather than duplicated because the interface only buys anything if the
 * implementations actually agree — and there are three of them now, across two
 * packages and two test runners. `describe`/`it`/`expect` are passed in because
 * vitest and `bun:test` are different imports; everything else is the same
 * suite either way.
 */

import type { Store } from '../src/store/store'


type Expectation = {
  toBe (value: unknown): void;
  toEqual (value: unknown): void;
  toBeNull (): void;
  not: { toContain (value: string): void };
}

export type Runner = {
  describe (name: string, body: () => void): void;
  it (name: string, body: () => Promise<void> | void): void;
  expect (value: unknown): Expectation;
}

/**
 * A fresh name per case.
 *
 * `NeonStore` runs against a real database that is still there on the next run,
 * so a hard-coded `Maverick` would pass once and then hit the unique index
 * forever. Memory and `:memory:` sqlite hid this by starting empty every time.
 * 18 characters, inside the 3-24 that `validCredentials` allows.
 */
export const uniqueName = (): string =>
  `Pilot_${crypto.randomUUID().replaceAll('-', '')
    .slice(0, 12)}`

const uniqueId = (): string => `m_${crypto.randomUUID()}`

export function runStoreContract (name: string, make: () => Store, runner: Runner): void {
  const { describe, it, expect } = runner

  describe(name, () => {
    it('round-trips an account', async () => {
      const store    = make()
      const username = uniqueName()
      const created  = await store.createAccount(username, 'hashed')

      expect(created?.username).toBe(username)
      expect((await store.accountById(created!.id))?.username).toBe(username)
      expect((await store.findAccount(username.toUpperCase()))?.passwordHash).toBe('hashed')

      // Postgres hands `bigint` back as a string unless something coerces it,
      // and `createdAt` is compared against `Date.now()` by every caller.
      expect(typeof created!.createdAt).toBe('number')
      store.close()
    })

    it('refuses a duplicate name regardless of casing', async () => {
      const store    = make()
      const username = uniqueName()
      await store.createAccount(username, 'a')

      expect(await store.createAccount(username.toLowerCase(), 'b')).toBeNull()
      store.close()
    })

    it('returns null for an unknown account', async () => {
      const store = make()
      expect(await store.findAccount(uniqueName())).toBeNull()
      expect(await store.accountById('not-an-id')).toBeNull()
      store.close()
    })

    it('resolves a live session and refuses an expired one', async () => {
      const store   = make()
      const account = await store.createAccount(uniqueName(), 'a')

      const live = await store.createSession(account!.id, 60_000)
      expect((await store.resolveSession(live.token))?.id).toBe(account!.id)

      const dead = await store.createSession(account!.id, -1)
      expect(await store.resolveSession(dead.token)).toBeNull()

      store.close()
    })

    it('forgets a dropped session', async () => {
      const store   = make()
      const account = await store.createAccount(uniqueName(), 'a')
      const session = await store.createSession(account!.id, 60_000)

      await store.dropSession(session.token)
      expect(await store.resolveSession(session.token)).toBeNull()
      store.close()
    })

    it('records a match and totals its rosters', async () => {
      const store   = make()
      const account = await store.createAccount(uniqueName(), 'a')
      const matchId = uniqueId()

      await store.recordMatchStart({
        id: matchId, mode: 'ctf', arena: 'apex', startedAt: 1, endedAt: null, winner: null, scores: { red: 0, blue: 0 },
      })
      await store.recordMatchPlayers([
        { matchId, accountId: account!.id, name: 'Maverick', team: 'red', kills: 4, deaths: 2, captures: 1 },
        // Guests and bots still get a row, so a roster is complete even when
        // most of it was never signed in.
        { matchId, accountId: null, name: 'Bot 1', team: 'blue', kills: 1, deaths: 4, captures: 0 },
      ])
      await store.recordMatchEnd(matchId, 99, 'red', { red: 5, blue: 1 })

      const stats = await store.statsFor(account!.id)
      expect(stats).toEqual({ matches: 1, kills: 4, deaths: 2, captures: 1 })

      // `count()` and `sum()` are int8 in Postgres, which the driver would hand
      // back as strings. `toEqual` above would catch it; this says why.
      expect(typeof stats.kills).toBe('number')
      store.close()
    })

    it('keeps a roster when its match is re-recorded', async () => {
      // `recordMatchStart` is upsert-shaped, and the obvious spelling of that in
      // SQLite — `INSERT OR REPLACE` — deletes the row first, firing
      // `match_players`' ON DELETE CASCADE and silently emptying the roster.
      // Postgres' `ON CONFLICT DO UPDATE` does not. This is the case that keeps
      // the two from drifting apart.
      const store   = make()
      const account = await store.createAccount(uniqueName(), 'a')
      const matchId = uniqueId()
      const match   = {
        id: matchId, mode: 'ctf', arena: 'apex', startedAt: 1, endedAt: null, winner: null, scores: {},
      }

      await store.recordMatchStart(match)
      await store.recordMatchPlayers([
        { matchId, accountId: account!.id, name: 'Maverick', team: 'red', kills: 3, deaths: 1, captures: 2 },
      ])
      await store.recordMatchStart({ ...match, arena: 'delta' })

      expect(await store.statsFor(account!.id)).toEqual({ matches: 1, kills: 3, deaths: 1, captures: 2 })
      store.close()
    })

    it('reports empty stats for someone who has never played', async () => {
      const store   = make()
      const account = await store.createAccount(uniqueName(), 'a')
      expect(await store.statsFor(account!.id)).toEqual({ matches: 0, kills: 0, deaths: 0, captures: 0 })
      store.close()
    })
  })
}
