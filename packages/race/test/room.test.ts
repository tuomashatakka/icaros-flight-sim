/**
 * The room writes a result, and the result reaches the scoreboard.
 *
 * This is the test the previous implementation could not have had: the
 * recording functions existed, were covered by their own unit tests, and were
 * called by nothing — so `statsFor` returned zeroes for the whole life of the
 * feature and every one of those tests still passed.
 *
 * So this one goes through a REAL Colyseus room, against a REAL Postgres
 * (PGlite), and asserts the number a player would actually see.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Server } from '@colyseus/core'
import { boot } from '@colyseus/testing'
import { createPilot, openDatabase, setDatabase, statsFor } from '@crash-velocity/data'
// Not from the barrel: `migrate` reads the generated SQL from disk at import,
// and the barrel is imported by Next route handlers that must not touch a
// filesystem. See the note at the top of packages/data/src/index.ts.
import { migratePglite } from '@crash-velocity/data/migrate'

import { RaceRoom } from '../src/room'

import type { ColyseusTestServer } from '@colyseus/testing'
import type { Database } from '@crash-velocity/data'


let colyseus: ColyseusTestServer
let db: Database

beforeAll(async () => {
  process.env.GAME_TOKEN_SECRET = 'test-secret'

  const handle = await openDatabase({ driver: 'pglite' })
  db = handle.db
  await migratePglite(db)
  setDatabase(db)

  const server = new Server({ greet: false })
  server.define('race', RaceRoom)
  colyseus = await boot(server, 0)
}, 90_000)

afterAll(async () => {
  await colyseus?.shutdown()
  setDatabase(null)
})

describe('race room', () => {
  it('writes a result on dispose, and it shows up in the pilot\'s stats', async () => {
    const pilot = await createPilot(db, `Ace_${Date.now()}`, 'scrypt$fake')
    expect(pilot).not.toBeNull()

    const room = await colyseus.createRoom('race', { trackId: 'flats', bots: 2 })

    // A racer the room believes is signed in. `onAuth` would normally put this
    // there from a verified ticket; standing up a whole sign-in would test
    // Auth.js rather than the recording path this case is about.
    const inner = room as unknown as {
      sim:       { addPlayer (name: string, ship: string): { id: string; progress: Record<string, unknown> }};
      pilotOf:   Map<string, string | null>;
      everRaced: boolean;
    }

    const racer = inner.sim.addPlayer('Ace', 'icaras')
    inner.pilotOf.set(racer.id, pilot!.id)
    inner.everRaced = true

    // Finish the race rather than driving three laps of it: what is under test
    // is that a FINISHED race is written down.
    racer.progress.finished   = true
    racer.progress.finishTime = 91.5
    racer.progress.bestLap    = 29.75
    racer.progress.lapTimes   = [ 31, 30.75, 29.75 ]

    await room.disconnect()

    const stats = await statsFor(db, pilot!.id)
    expect(stats.races).toBe(1)
    expect(stats.wins).toBe(1)
    expect(stats.bestLap).toBeCloseTo(29.75, 2)
  }, 90_000)

  it('leaves no trace for a room nobody raced in', async () => {
    const pilot = await createPilot(db, `Ghost_${Date.now()}`, 'scrypt$fake')
    const room  = await colyseus.createRoom('race', { trackId: 'flats', bots: 0 })

    await room.disconnect()

    expect(await statsFor(db, pilot!.id)).toMatchObject({ races: 0, matches: 0 })
  }, 90_000)
})
