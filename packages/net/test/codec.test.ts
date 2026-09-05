/**
 * The wire format, round-tripped.
 *
 * These are the assertions that make bit-packing safe to rely on: if a decoded
 * snapshot is not the encoded one within a quantisation step, every ship on
 * screen is subtly in the wrong place and nothing else in the stack will say so.
 */

import { describe, expect, it } from 'vitest'

import { BitReader, BitWriter } from '../src/codec/bits'
import { QUAT_BITS, packQuaternion, unpackQuaternion } from '../src/codec/quantize'
import { DEFAULT_SHIP_CODEC, ShipField, ShipFlags, changedFields, emptyShipState } from '../src/codec/ship-state'
import { StaleBaselineError, baselineOf, decodeSnapshot, encodeSnapshot } from '../src/codec/snapshot'
import { decodeInputPacket, emptyInputFrame, encodeInputPacket } from '../src/codec/input'

import type { ShipState } from '../src/codec/ship-state'


function shipAt (id: number, over: Partial<ShipState> = {}): ShipState {
  return { ...emptyShipState(id), x: 12.5, y: 3.25, z: -230.75, qx: 0, qy: 0.3826834, qz: 0, qw: 0.9238795, vx: 40, vy: -1.5, vz: 12, wx: 0.4, wy: -2, wz: 0.1, health: 87, flags: ShipFlags.ALIVE | ShipFlags.BOOSTING, respawnIndex: 3, aim: -0.25, ...over }
}

describe('bit stream', () => {
  it('round-trips values at every width, in any order', () => {
    const writer = new BitWriter(8)
    writer.writeBits(1, 1)
    writer.writeBits(5, 3)
    writer.writeBits(1023, 10)
    writer.writeBits(0xffffffff, 32)
    writer.writeSigned(-511, 10)
    writer.writeFloat64(1234.5678)
    writer.writeString('Maverick')

    const reader = new BitReader(writer.finish())
    expect(reader.readBits(1)).toBe(1)
    expect(reader.readBits(3)).toBe(5)
    expect(reader.readBits(10)).toBe(1023)
    expect(reader.readBits(32)).toBe(0xffffffff)
    expect(reader.readSigned(10)).toBe(-511)
    expect(reader.readFloat64()).toBe(1234.5678)
    expect(reader.readString()).toBe('Maverick')
  })

  it('grows past its initial capacity without corrupting what is already written', () => {
    const writer = new BitWriter(1)
    for (let i = 0; i < 500; i++)
      writer.writeBits(i & 0x3ff, 10)

    const reader = new BitReader(writer.finish())
    for (let i = 0; i < 500; i++)
      expect(reader.readBits(10)).toBe(i & 0x3ff)
  })
})

describe('smallest-three quaternion', () => {
  it('fits in 32 bits', () => {
    expect(QUAT_BITS).toBe(32)
  })

  it('survives the round trip inside the 10-bit bound, for random rotations', () => {
    // One quantisation step over the ±1/√2 range, with room for the recovered
    // largest component to accumulate the other three's error.
    const tolerance = 2 * Math.SQRT1_2 / 1023 * 2

    let worst = 0
    for (let i = 0; i < 2000; i++) {
      const q    = randomQuat(i)
      const back = unpackQuaternion(packQuaternion(q))

      // q and −q are the same rotation, so compare through the dot product.
      const dot   = Math.abs(q.x * back.x + q.y * back.y + q.z * back.z + q.w * back.w)
      const error = Math.max(Math.abs(1 - dot), 0)
      worst = Math.max(worst, error)
      expect(back.x ** 2 + back.y ** 2 + back.z ** 2 + back.w ** 2).toBeCloseTo(1, 5)
    }

    expect(worst).toBeLessThan(tolerance)
  })
})

describe('snapshot', () => {
  it('round-trips a full snapshot within a quantisation step', () => {
    const snapshot = { serverTick: 4096, serverTimeMs: 1699999999999, baselineTick: 0, lastProcessedInput: 77, ships: [ shipAt(1), shipAt(2, { x: -500, health: 12 }) ], removed: []}
    const decoded  = decodeSnapshot(encodeSnapshot(snapshot, null), null)

    expect(decoded.serverTick).toBe(4096)
    expect(decoded.serverTimeMs).toBe(1699999999999)
    expect(decoded.lastProcessedInput).toBe(77)
    expect(decoded.ships).toHaveLength(2)

    const [ a ] = decoded.ships
    expect(a.x).toBeCloseTo(12.5, 2)
    expect(a.z).toBeCloseTo(-230.75, 2)
    expect(a.vx).toBeCloseTo(40, 1)
    expect(a.wy).toBeCloseTo(-2, 1)
    expect(a.health).toBe(87)
    expect(a.flags).toBe(ShipFlags.ALIVE | ShipFlags.BOOSTING)
    expect(a.respawnIndex).toBe(3)
    expect(a.aim).toBeCloseTo(-0.25, 2)
  })

  it('encodes a delta smaller than the full snapshot, and reconstructs it', () => {
    const first    = { serverTick: 100, serverTimeMs: 1000, baselineTick: 0, lastProcessedInput: 1, ships: [ shipAt(1), shipAt(2), shipAt(3) ], removed: []}
    const full     = encodeSnapshot(first, null)
    const baseline = baselineOf(decodeSnapshot(full, null))

    // Only one ship moved, and only its position.
    const second = { serverTick: 102, serverTimeMs: 1066, baselineTick: 100, lastProcessedInput: 4, ships: [ shipAt(1, { x: 40 }), shipAt(2), shipAt(3) ], removed: []}
    const delta  = encodeSnapshot(second, baseline)

    expect(delta.byteLength).toBeLessThan(full.byteLength / 2)

    const decoded = decodeSnapshot(delta, baseline)
    expect(decoded.ships[0].x).toBeCloseTo(40, 2)
    // Carried forward from the baseline rather than re-sent.
    expect(decoded.ships[1].z).toBeCloseTo(-230.75, 2)
    expect(decoded.ships[2].health).toBe(87)
  })

  it('refuses a delta whose baseline is gone rather than decoding nonsense', () => {
    const snapshot = { serverTick: 200, serverTimeMs: 2000, baselineTick: 150, lastProcessedInput: 9, ships: [ shipAt(1) ], removed: []}
    const baseline = baselineOf({ ...snapshot, serverTick: 150 })
    const bytes    = encodeSnapshot(snapshot, baseline)

    expect(() => decodeSnapshot(bytes, { tick: 149, ships: new Map() })).toThrow(StaleBaselineError)
  })

  it('falls back to a full encode when the client has acknowledged nothing', () => {
    const snapshot = { serverTick: 5, serverTimeMs: 50, baselineTick: 0, lastProcessedInput: 0, ships: [ shipAt(1) ], removed: []}
    // No baseline held, yet it still decodes — that is what a joining client gets.
    expect(decodeSnapshot(encodeSnapshot(snapshot, null), null).ships[0].health).toBe(87)
  })

  it('carries removals so a client can drop a ship it will not see again', () => {
    const snapshot = { serverTick: 9, serverTimeMs: 90, baselineTick: 0, lastProcessedInput: 0, ships: [], removed: [ 7, 8 ]}
    expect(decodeSnapshot(encodeSnapshot(snapshot, null), null).removed).toEqual([ 7, 8 ])
  })

  it('reports a field unchanged when it only moved by less than a quantisation step', () => {
    const a = shipAt(1)
    expect(changedFields(a, { ...a, x: a.x + 1e-6 }, DEFAULT_SHIP_CODEC) & ShipField.POSITION).toBe(0)
    expect(changedFields(a, { ...a, x: a.x + 1 }, DEFAULT_SHIP_CODEC) & ShipField.POSITION).toBe(ShipField.POSITION)
  })
})

describe('input packet', () => {
  it('round-trips a bundle of unacknowledged frames', () => {
    const frames = [ 1, 2, 3 ].map(seq => ({ ...emptyInputFrame(seq, 900 + seq), steer: -0.5, pitch: 0.25, strafe: 1, throttle: 0.75, brake: 0, buttons: 0b0101, resetSeq: 2 }))
    const packet = decodeInputPacket(encodeInputPacket({ frames, lastAckSnapshot: 640, interpTick: 620 }))

    expect(packet.lastAckSnapshot).toBe(640)
    expect(packet.interpTick).toBe(620)
    expect(packet.frames).toHaveLength(3)
    expect(packet.frames[0].seq).toBe(1)
    expect(packet.frames[2].clientTick).toBe(903)
    expect(packet.frames[1].steer).toBeCloseTo(-0.5, 2)
    expect(packet.frames[1].throttle).toBeCloseTo(0.75, 2)
    expect(packet.frames[1].buttons).toBe(0b0101)
    expect(packet.frames[1].resetSeq).toBe(2)
  })

  it('costs about sixteen bytes a frame, so a typical bundle is tiny', () => {
    // The bundle only reaches its 32-frame cap after half a second of total
    // packet loss. What decides bandwidth in normal play is the per-frame cost
    // and the two or three frames actually in flight.
    const header = encodeInputPacket({ frames: [], lastAckSnapshot: 1, interpTick: 1 }).byteLength
    const full   = encodeInputPacket({ frames: Array.from({ length: 32 }, (_, i) => emptyInputFrame(i + 1, i)), lastAckSnapshot: 1, interpTick: 1 }).byteLength

    expect((full - header) / 32).toBeLessThanOrEqual(16)

    const typical = encodeInputPacket({ frames: [ 1, 2, 3 ].map(s => emptyInputFrame(s, s)), lastAckSnapshot: 1, interpTick: 1 })
    expect(typical.byteLength).toBeLessThan(64)
  })
})

// A deterministic spread of unit quaternions; no Math.random in a test that
//  asserts a bound, or a failure is unreproducible.
function randomQuat (seed: number) {
  const a = Math.sin(seed * 12.9898) * 43758.5453
  const b = Math.sin(seed * 78.233) * 12345.6789
  const c = Math.sin(seed * 39.425) * 24634.6345
  const d = Math.cos(seed * 51.171) * 31415.9265

  const v = [ a - Math.floor(a) - 0.5, b - Math.floor(b) - 0.5, c - Math.floor(c) - 0.5, d - Math.floor(d) - 0.5 ]
  const n = Math.hypot(...v) || 1
  return { x: v[0] / n, y: v[1] / n, z: v[2] / n, w: v[3] / n }
}
