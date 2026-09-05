/**
 * The 60 Hz input packet, client to server.
 *
 * Every packet carries EVERY frame the server has not acknowledged, not just
 * the newest one and not just what changed. A `dirty` flag once sent a held
 * throttle exactly once, so a single dropped packet left the server driving on
 * stale input indefinitely. Re-sending the tail makes loss self-healing: the
 * next packet contains everything the lost one did.
 *
 * Axes are quantised to 10 bits, which is finer than any input device resolves
 * and — more to the point — is applied identically on both sides, so the frame
 * the client predicted with is bit-for-bit the frame the server replays.
 */

import { BitReader, BitWriter } from './bits'
import { MAX_INPUT_FRAMES } from '../rates'
import { dequantize, quantize } from './quantize'


export type InputFrame = {
  seq:        number;
  clientTick: number;

  /** Held axes, −1..1. `pitch` is the vertical aim trim, not a rate. */
  steer:  number;
  pitch:  number;
  strafe: number;

  /** 0..1. */
  throttle: number;
  brake:    number;

  buttons: number;

  /** Wrapping counter; an increment is a respawn request. */
  resetSeq: number;
}

export const InputButton = {
  BOOST:     1 << 0,
  FIRE:      1 << 1,
  SECONDARY: 1 << 2,
  REVERSE:   1 << 3,
} as const

export type InputPacket = {
  frames: InputFrame[];

  /** The newest snapshot the client holds; the server deltas against it. */
  lastAckSnapshot: number;

  /** Server time the client is rendering remotes at, for lag compensation. */
  interpTick: number;
}

const AXIS_BITS  = 10
const LEVEL_BITS = 8

export function emptyInputFrame (seq = 0, clientTick = 0): InputFrame {
  return { seq, clientTick, steer: 0, pitch: 0, strafe: 0, throttle: 0, brake: 0, buttons: 0, resetSeq: 0 }
}

export function encodeInputPacket (packet: InputPacket): Uint8Array {
  const frames = packet.frames.slice(-MAX_INPUT_FRAMES)
  const writer = new BitWriter(32 + frames.length * 16)

  writer.writeBits(packet.lastAckSnapshot, 32)
  writer.writeBits(packet.interpTick, 32)
  writer.writeBits(frames.length, 8)

  for (const frame of frames) {
    writer.writeBits(frame.seq, 32)
    writer.writeBits(frame.clientTick, 32)
    writer.writeBits(quantize(frame.steer, -1, 1, AXIS_BITS), AXIS_BITS)
    writer.writeBits(quantize(frame.pitch, -1, 1, AXIS_BITS), AXIS_BITS)
    writer.writeBits(quantize(frame.strafe, -1, 1, AXIS_BITS), AXIS_BITS)
    writer.writeBits(quantize(frame.throttle, 0, 1, LEVEL_BITS), LEVEL_BITS)
    writer.writeBits(quantize(frame.brake, 0, 1, LEVEL_BITS), LEVEL_BITS)
    writer.writeBits(frame.buttons & 0xff, 8)
    writer.writeBits(frame.resetSeq & 0xff, 8)
  }

  return writer.finish()
}

export function decodeInputPacket (bytes: Uint8Array): InputPacket {
  const reader = new BitReader(bytes)

  const lastAckSnapshot = reader.readBits(32)
  const interpTick      = reader.readBits(32)
  const count           = Math.min(reader.readBits(8), MAX_INPUT_FRAMES)

  const frames: InputFrame[] = []

  for (let i = 0; i < count; i++)
    frames.push({
      seq:        reader.readBits(32),
      clientTick: reader.readBits(32),
      steer:      dequantize(reader.readBits(AXIS_BITS), -1, 1, AXIS_BITS),
      pitch:      dequantize(reader.readBits(AXIS_BITS), -1, 1, AXIS_BITS),
      strafe:     dequantize(reader.readBits(AXIS_BITS), -1, 1, AXIS_BITS),
      throttle:   dequantize(reader.readBits(LEVEL_BITS), 0, 1, LEVEL_BITS),
      brake:      dequantize(reader.readBits(LEVEL_BITS), 0, 1, LEVEL_BITS),
      buttons:    reader.readBits(8),
      resetSeq:   reader.readBits(8),
    })

  return { frames, lastAckSnapshot, interpTick }
}
