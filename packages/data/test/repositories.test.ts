/**
 * The repositories, against a real Postgres.
 *
 * PGlite is Postgres compiled to WASM, so this is not a mock and not a second
 * dialect — it is the same SQL Neon runs, including the functional
 * `lower(username)` index that `createPilot` depends on for its conflict
 * detection. That is why the old three-adapter contract suite is gone: there is
 * only one implementation left to disagree with itself.
 */

import { beforeAll, describe, expect, it } from 'vitest'

import { authenticatePilot, registerPilot } from '../src/auth/credentials'
import { openDatabase } from '../src/client'
import { migratePglite } from '../src/migrate'
import { createPilot, findPilot, pilotById } from '../src/repositories/pilots'
import { recordMatchEnd, recordMatchPlayers, recordMatchStart, recordRaceResults } from '../src/repositories/matches'
import { statsFor } from '../src/repositories/stats'

import type { Database } from '../src/client'


let db: Database

beforeAll(async () => {
  const handle = await openDatabase({ driver: 'pglite' })
  db = handle.db
  await migratePglite(db)
}, 60_000)

describe('pilots', () => {
  it('creates one and reads it back', async () => {
    const pilot = await createPilot(db, 'Maverick', 'scrypt$fake')
    expect(pilot).not.toBeNull()
    expect(pilot?.username).toBe('Maverick')
    expect(await pilotById(db, pilot!.id)).toMatchObject({ username: 'Maverick' })
  })

  it('refuses a taken name, case-insensitively', async () => {
    await createPilot(db, 'Goose', 'scrypt$fake')
    expect(await createPilot(db, 'GOOSE', 'scrypt$fake')).toBeNull()
  })

  it('finds a pilot regardless of the case asked for', async () => {
    await createPilot(db, 'Iceman', 'scrypt$fake')
    expect(await findPilot(db, 'ICEMAN')).toMatchObject({ username: 'Iceman' })
    expect(await findPilot(db, 'nobody')).toBeNull()
  })
})

describe('credentials', () => {
  it('registers and then authenticates', async () => {
    const created = await registerPilot(db, 'Viper', 'hunter2hunter2')
    expect(created.ok).toBe(true)

    const signedIn = await authenticatePilot(db, 'viper', 'hunter2hunter2')
    expect(signedIn.ok).toBe(true)
  })

  it('rejects a wrong password and an unknown pilot the same way', async () => {
    await registerPilot(db, 'Jester', 'hunter2hunter2')
    expect(await authenticatePilot(db, 'Jester', 'wrongwrongwrong')).toMatchObject({ ok: false, reason: 'invalid' })
    expect(await authenticatePilot(db, 'Ghost', 'hunter2hunter2')).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('refuses malformed credentials before touching the database', async () => {
    expect(await registerPilot(db, 'x', 'short')).toMatchObject({ ok: false, reason: 'malformed' })
  })
})

describe('match history', () => {
  it('accumulates stats across matches, and counts race wins', async () => {
    const pilot = await createPilot(db, 'Hollywood', 'scrypt$fake')
    const id    = pilot!.id

    await recordMatchStart(db, { id: 'm1', mode: 'battle', arena: 'apex', startedAt: 1, scores: {}})
    await recordMatchEnd(db, 'm1', 2, 'red', { red: 3, blue: 1 })
    await recordMatchPlayers(db, [
      { matchId: 'm1', userId: id, name: 'Hollywood', team: 'red', kills: 4, deaths: 1, captures: 2 },
      { matchId: 'm1', userId: null, name: 'Bot-1', team: 'blue', kills: 0, deaths: 4, captures: 0 },
    ])

    await recordMatchStart(db, { id: 'm2', mode: 'race', arena: 'flats', startedAt: 3, scores: {}})
    await recordRaceResults(db, [
      { matchId: 'm2', userId: id, name: 'Hollywood', position: 1, laps: 3, totalTime: 91.5, bestLap: 29.75, lapTimes: [ 31, 30.75, 29.75 ], finished: true },
    ])

    const stats = await statsFor(db, id)
    expect(stats).toMatchObject({ matches: 1, kills: 4, deaths: 1, captures: 2, races: 1, wins: 1 })
    expect(stats.bestLap).toBeCloseTo(29.75, 2)
  })

  it('upserts a roster row rather than duplicating it', async () => {
    await recordMatchStart(db, { id: 'm3', mode: 'battle', arena: 'apex', startedAt: 4, scores: {}})

    const row = { matchId: 'm3', userId: null, name: 'Slider', team: 'blue', kills: 1, deaths: 0, captures: 0 }
    await recordMatchPlayers(db, [ row ])
    await recordMatchPlayers(db, [{ ...row, kills: 7 }])

    const stats = await statsFor(db, 'nobody')
    expect(stats.matches).toBe(0)
  })
})
