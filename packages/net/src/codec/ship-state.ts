/**
 * One ship on the wire.
 *
 * The field list is the architecture document's, plus two this engine cannot
 * do without:
 *
 * - `respawnIndex` — a wrapping counter that is the ONLY teleport signal.
 *   Inferring a relocation from a kill event means a dropped event draws a ship
 *   streaking across the arena, and blending an interpolator across a teleport
 *   does it every time.
 * - `aim` — the authoritative vertical trim. It is integrated inside the sim so
 *   it stays deterministic and survives the netcode, which means it has to come
 *   back down the wire rather than being re-derived from input.
 *
 * Velocities are carried, unlike the previous JSON snapshot which sent pose
 * only. Without them a receiver has to finite-difference two poses to
 * extrapolate, which turns one late packet into a visible lurch.
 */

import { QUAT_BITS, dequantize, packQuaternion, quantize, unpackQuaternion } from './quantize'

import type { BitReader, BitWriter } from './bits'


export type ShipState = {
  id:           number;
  x:            number;  y: number;  z: number;
  qx:           number; qy: number; qz: number; qw: number;
  vx:           number; vy: number; vz: number;
  wx:           number; wy: number; wz: number;
  health:       number;
  flags:        number;
  respawnIndex: number;
  aim:          number;
}

export const ShipFlags = {
  ALIVE:      1 << 0,
  BOOSTING:   1 << 1,
  RESPAWNING: 1 << 2,
  GROUNDED:   1 << 3,
  BRAKING:    1 << 4,
  FIRING:     1 << 5,
} as const

export const ShipField = {
  POSITION: 1 << 0,
  ROTATION: 1 << 1,
  LINVEL:   1 << 2,
  ANGVEL:   1 << 3,
  HEALTH:   1 << 4,
  FLAGS:    1 << 5,
  RESPAWN:  1 << 6,
  AIM:      1 << 7,
} as const

export const ALL_SHIP_FIELDS = 0xff

export type ShipCodecConfig = {
  positionBounds: number;
  positionBits:   number;
  velocityBounds: number;
  velocityBits:   number;
  angularBounds:  number;
  angularBits:    number;
}

/**
 * Defaults sized for this game's arenas.
 *
 * ±1024 m across 18 bits is 8 mm of position resolution — an order of magnitude
 * finer than the 0.35 m reconciliation deadband, so quantisation can never be
 * what triggers a correction. Angular velocity is bounded at 16 rad/s because
 * the runaway clamp in the vehicle step will not let a hull spin faster.
 */
export const DEFAULT_SHIP_CODEC: ShipCodecConfig = {
  positionBounds: 1024,
  positionBits:   18,
  velocityBounds: 256,
  velocityBits:   16,
  angularBounds:  16,
  angularBits:    12,
}

export function emptyShipState (id = 0): ShipState {
  return {
    id, x: 0, y: 0, z: 0,
    qx: 0, qy: 0, qz: 0, qw: 1,
    vx: 0, vy: 0, vz: 0,
    wx: 0, wy: 0, wz: 0,
    health: 0, flags: 0, respawnIndex: 0, aim: 0,
  }
}

/**
 * Which fields differ enough to be worth sending.
 *
 * The thresholds are one quantisation step: below that the receiver would
 * reconstruct the identical number anyway, so the bits would buy nothing.
 */
export function changedFields (previous: ShipState, next: ShipState, config = DEFAULT_SHIP_CODEC): number {
  const posStep = (2 * config.positionBounds) / ((1 << config.positionBits) - 1)
  const velStep = (2 * config.velocityBounds) / ((1 << config.velocityBits) - 1)
  const angStep = (2 * config.angularBounds) / ((1 << config.angularBits) - 1)

  let mask = 0

  if (differs(previous.x, next.x, posStep) || differs(previous.y, next.y, posStep) || differs(previous.z, next.z, posStep))
    mask |= ShipField.POSITION

  // Compared through the packer rather than component-wise: two quaternions
  // that quantise to the same 32 bits are the same rotation on the wire, and
  // sending the difference between them would be sending nothing.
  if (packQuaternion(quatOf(previous)) !== packQuaternion(quatOf(next)))
    mask |= ShipField.ROTATION

  if (differs(previous.vx, next.vx, velStep) || differs(previous.vy, next.vy, velStep) || differs(previous.vz, next.vz, velStep))
    mask |= ShipField.LINVEL

  if (differs(previous.wx, next.wx, angStep) || differs(previous.wy, next.wy, angStep) || differs(previous.wz, next.wz, angStep))
    mask |= ShipField.ANGVEL

  if (previous.health !== next.health)
    mask |= ShipField.HEALTH

  if (previous.flags !== next.flags)
    mask |= ShipField.FLAGS

  if (previous.respawnIndex !== next.respawnIndex)
    mask |= ShipField.RESPAWN

  if (differs(previous.aim, next.aim, 1 / 2048))
    mask |= ShipField.AIM

  return mask
}

function quatOf (ship: ShipState) {
  return { x: ship.qx, y: ship.qy, z: ship.qz, w: ship.qw }
}

function differs (a: number, b: number, step: number): boolean {
  return Math.abs(a - b) >= step
}

export function writeShipState (writer: BitWriter, ship: ShipState, mask: number, config = DEFAULT_SHIP_CODEC): void {
  const { positionBounds: p, positionBits: pb, velocityBounds: v, velocityBits: vb, angularBounds: a, angularBits: ab } = config

  if (mask & ShipField.POSITION) {
    writer.writeBits(quantize(ship.x, -p, p, pb), pb)
    writer.writeBits(quantize(ship.y, -p, p, pb), pb)
    writer.writeBits(quantize(ship.z, -p, p, pb), pb)
  }

  if (mask & ShipField.ROTATION)
    writer.writeBits(packQuaternion({ x: ship.qx, y: ship.qy, z: ship.qz, w: ship.qw }), QUAT_BITS)

  if (mask & ShipField.LINVEL) {
    writer.writeBits(quantize(ship.vx, -v, v, vb), vb)
    writer.writeBits(quantize(ship.vy, -v, v, vb), vb)
    writer.writeBits(quantize(ship.vz, -v, v, vb), vb)
  }

  if (mask & ShipField.ANGVEL) {
    writer.writeBits(quantize(ship.wx, -a, a, ab), ab)
    writer.writeBits(quantize(ship.wy, -a, a, ab), ab)
    writer.writeBits(quantize(ship.wz, -a, a, ab), ab)
  }

  if (mask & ShipField.HEALTH)
    writer.writeBits(Math.max(0, Math.min(255, Math.round(ship.health))), 8)

  if (mask & ShipField.FLAGS)
    writer.writeBits(ship.flags & 0xff, 8)

  if (mask & ShipField.RESPAWN)
    writer.writeBits(ship.respawnIndex & 0xff, 8)

  if (mask & ShipField.AIM)
    writer.writeBits(quantize(ship.aim, -1, 1, 12), 12)
}

/** Fields absent from `mask` are copied from `into`, which is the baseline. */
export function readShipState (reader: BitReader, mask: number, into: ShipState, config = DEFAULT_SHIP_CODEC): ShipState {
  const { positionBounds: p, positionBits: pb, velocityBounds: v, velocityBits: vb, angularBounds: a, angularBits: ab } = config

  if (mask & ShipField.POSITION) {
    into.x = dequantize(reader.readBits(pb), -p, p, pb)
    into.y = dequantize(reader.readBits(pb), -p, p, pb)
    into.z = dequantize(reader.readBits(pb), -p, p, pb)
  }

  if (mask & ShipField.ROTATION) {
    const q = unpackQuaternion(reader.readBits(QUAT_BITS))
    into.qx = q.x
    into.qy = q.y
    into.qz = q.z
    into.qw = q.w
  }

  if (mask & ShipField.LINVEL) {
    into.vx = dequantize(reader.readBits(vb), -v, v, vb)
    into.vy = dequantize(reader.readBits(vb), -v, v, vb)
    into.vz = dequantize(reader.readBits(vb), -v, v, vb)
  }

  if (mask & ShipField.ANGVEL) {
    into.wx = dequantize(reader.readBits(ab), -a, a, ab)
    into.wy = dequantize(reader.readBits(ab), -a, a, ab)
    into.wz = dequantize(reader.readBits(ab), -a, a, ab)
  }

  if (mask & ShipField.HEALTH)
    into.health = reader.readBits(8)

  if (mask & ShipField.FLAGS)
    into.flags = reader.readBits(8)

  if (mask & ShipField.RESPAWN)
    into.respawnIndex = reader.readBits(8)

  if (mask & ShipField.AIM)
    into.aim = dequantize(reader.readBits(12), -1, 1, 12)

  return into
}
