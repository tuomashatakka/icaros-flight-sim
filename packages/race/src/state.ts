/**
 * The half of race state that Colyseus synchronises.
 *
 * Same split as battle: slow, variably-shaped facts here; poses and velocities
 * on the bit-packed binary channel. Lap counts, positions and best laps change
 * a handful of times a minute, and the schema encoder handles late joiners and
 * deltas for them for free.
 *
 * `netIndex` is the join between the two channels — the uint16 a ship is known
 * by in the binary snapshot.
 */

import { schema, t } from '@colyseus/schema'

import type { SchemaType } from '@colyseus/schema'
import type { RaceSnapshot } from './types'


export const RacerState = schema({
  id:       t.string(),
  name:     t.string(),
  shipId:   t.string(),
  isBot:    t.boolean().default(false),
  netIndex: t.uint16().default(0),

  // Hull integrity, rounded to a byte. On the schema channel rather than the
  // bit-packed one because race's binary `health` field already carries the
  // boost meter — see `snapshot.ts` — and hull changes on impacts, not ticks.
  health: t.uint8().default(100),

  lap:            t.uint8().default(1),
  position:       t.uint8().default(1),
  nextCheckpoint: t.uint8().default(0),
  finished:       t.boolean().default(false),

  // Clocks tick continuously. They were briefly marked `.unreliable()`, but an
  // unreliable field over a WEBSOCKET transport is never patched at all — the
  // lane only exists on `@colyseus/h3-transport` (WebTransport), and Colyseus
  // warns about it at boot. Reliable at 20 Hz costs a handful of bytes.
  elapsed:    t.number().default(0),
  lapElapsed: t.number().default(0),

  // −1 rather than null: the wire has no nullable number, and a best lap of
  //  minus one second is not a value anything can mistake for a real one.
  bestLap: t.number().default(-1),
}, 'RacerState')

export const RaceState = schema({
  trackId:   t.string().default('flats'),
  status:    t.string().default('lobby'),
  countdown: t.number().default(0),
  laps:      t.uint8().default(3),

  /** Authoritative tick, so a late joiner can seed its clock before the first snapshot. */
  serverTick: t.uint32().default(0),

  racers: t.map(RacerState),
}, 'RaceState')

export type RacerStateType = SchemaType<typeof RacerState>
export type RaceStateType = SchemaType<typeof RaceState>

/** Mirror a sim snapshot into the synchronised state. Poses never touch this. */
export function syncRaceState (
  state: RaceStateType,
  snapshot: RaceSnapshot,
  netIndexOf: (racerId: string) => number,
): void {
  set(state, 'trackId', snapshot.trackId)
  set(state, 'status', snapshot.status)
  set(state, 'countdown', round(snapshot.countdown))
  set(state, 'laps', snapshot.laps)
  set(state, 'serverTick', snapshot.tick)

  const seen = new Set<string>()

  for (const racer of snapshot.racers) {
    seen.add(racer.id)

    let entry = state.racers.get(racer.id)
    if (!entry) {
      entry = new RacerState({ id: racer.id, name: racer.name, shipId: racer.shipId, isBot: racer.isBot })
      state.racers.set(racer.id, entry)
    }

    set(entry, 'netIndex', netIndexOf(racer.id))
    set(entry, 'health', Math.max(0, Math.min(255, Math.round(racer.health))))
    set(entry, 'lap', racer.lap)
    set(entry, 'position', racer.position)
    set(entry, 'nextCheckpoint', racer.nextCheckpoint)
    set(entry, 'finished', racer.finished)
    set(entry, 'elapsed', round(racer.elapsed))
    set(entry, 'lapElapsed', round(racer.lapElapsed))
    set(entry, 'bestLap', racer.bestLap === null ? -1 : round(racer.bestLap))
  }

  for (const id of [ ...state.racers.keys() ])
    if (!seen.has(id))
      state.racers.delete(id)
}

// Millisecond precision. Finer than anything displayed, and it stops float
//  noise from marking a field dirty on every patch.
function round (value: number): number {
  return Math.round(value * 1000) / 1000
}

function set<T extends object, K extends keyof T> (target: T, key: K, value: T[K]): void {
  if (target[key] !== value)
    target[key] = value
}
