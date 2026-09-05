/**
 * The 20–30 Hz state message, delta-compressed against what the client has
 * already acknowledged.
 *
 * The Quake 3 model: every snapshot names the baseline it was encoded against,
 * every ship carries a bitmask of what actually changed since then, and
 * anything absent from the mask is copied forward. `baselineTick === 0` means
 * "no baseline" and forces a full encode, which is what a joining client and a
 * client that has fallen behind both get.
 *
 * The client acknowledges baselines by echoing `lastAckSnapshot` in its input
 * packets, so the server only ever deltas against a snapshot it knows arrived.
 * That is what makes this safe over a lossy channel: a dropped snapshot costs
 * one bigger snapshot later, never a permanently wrong ship.
 */

import { BitReader, BitWriter } from './bits'
import { ALL_SHIP_FIELDS, DEFAULT_SHIP_CODEC, changedFields, emptyShipState, readShipState, writeShipState } from './ship-state'

import type { ShipCodecConfig, ShipState } from './ship-state'


export type Snapshot = {
  serverTick:         number;
  serverTimeMs:       number;
  baselineTick:       number;
  lastProcessedInput: number;
  ships:              ShipState[];
  removed:            number[];
}

export type Baseline = {
  tick:  number;
  ships: Map<number, ShipState>;
}

const MAX_SHIPS   = 0xffff
const MAX_REMOVED = 0xff

export function encodeSnapshot (snapshot: Snapshot, baseline: Baseline | null, config: ShipCodecConfig = DEFAULT_SHIP_CODEC): Uint8Array {
  const writer   = new BitWriter(256 + snapshot.ships.length * 32)
  const useDelta = baseline !== null && baseline.tick === snapshot.baselineTick && snapshot.baselineTick !== 0

  writer.writeBits(snapshot.serverTick, 32)
  writer.writeFloat64(snapshot.serverTimeMs)
  writer.writeBits(useDelta ? snapshot.baselineTick : 0, 32)
  writer.writeBits(snapshot.lastProcessedInput, 32)
  writer.writeBits(Math.min(snapshot.ships.length, MAX_SHIPS), 16)

  for (const ship of snapshot.ships) {
    const previous = useDelta ? baseline.ships.get(ship.id) : undefined
    const mask     = previous ? changedFields(previous, ship, config) : ALL_SHIP_FIELDS

    writer.writeBits(ship.id & 0xffff, 16)
    writer.writeBool(!previous)
    writer.writeBits(mask, 8)
    writeShipState(writer, ship, mask, config)
  }

  const removed = snapshot.removed.slice(0, MAX_REMOVED)
  writer.writeBits(removed.length, 8)
  for (const id of removed)
    writer.writeBits(id & 0xffff, 16)

  return writer.finish()
}

export function decodeSnapshot (bytes: Uint8Array, baseline: Baseline | null, config: ShipCodecConfig = DEFAULT_SHIP_CODEC): Snapshot {
  const reader = new BitReader(bytes)

  const serverTick         = reader.readBits(32)
  const serverTimeMs       = reader.readFloat64()
  const baselineTick       = reader.readBits(32)
  const lastProcessedInput = reader.readBits(32)
  const count              = reader.readBits(16)

  // A delta whose baseline we no longer hold is undecodable — not corrupt, just
  // unusable. Throwing here would kill the socket; the caller drops it and
  // waits for the next full snapshot, which the server sends as soon as its
  // acknowledgement stops arriving.
  const usable = baselineTick === 0 || baseline !== null && baseline.tick === baselineTick
  if (!usable)
    throw new StaleBaselineError(baselineTick)

  const ships: ShipState[] = []

  for (let i = 0; i < count; i++) {
    const id     = reader.readBits(16)
    const isNew  = reader.readBool()
    const mask   = reader.readBits(8)
    const source = !isNew && baseline ? baseline.ships.get(id) : undefined
    const target = source ? { ...source, id } : emptyShipState(id)

    ships.push(readShipState(reader, mask, target, config))
  }

  const removedCount      = reader.readBits(8)
  const removed: number[] = []
  for (let i = 0; i < removedCount; i++)
    removed.push(reader.readBits(16))

  return { serverTick, serverTimeMs, baselineTick, lastProcessedInput, ships, removed }
}

export class StaleBaselineError extends Error {
  constructor (public readonly baselineTick: number) {
    super(`snapshot deltas against tick ${baselineTick}, which is no longer held`)
    this.name = 'StaleBaselineError'
  }
}

/** Turn a decoded snapshot into the baseline the next one may delta against. */
export function baselineOf (snapshot: Snapshot): Baseline {
  const ships = new Map<number, ShipState>()
  for (const ship of snapshot.ships)
    ships.set(ship.id, { ...ship })
  return { tick: snapshot.serverTick, ships }
}

/**
 * The envelope every FRESH snapshot shares, straight off a sim tick.
 *
 * `baselineTick` and `lastProcessedInput` are filled in later, per client, by
 * `encodeFor` in `seats.ts`; `removed` has no equivalent in either sim yet.
 * Race and battle read their ships completely differently, but the envelope
 * around them should not be a second place the two formats could drift.
 */
export function buildSnapshot (serverTick: number, ships: ShipState[]): Snapshot {
  return { serverTick, serverTimeMs: Date.now(), baselineTick: 0, lastProcessedInput: 0, ships, removed: []}
}
