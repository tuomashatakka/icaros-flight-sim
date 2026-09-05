/**
 * Netcode, shared by every mode.
 *
 * Nothing in here knows what a race or a battle is. It knows about ticks,
 * snapshots, inputs, clocks and the gap between where the server says a thing
 * is and where the screen is currently drawing it.
 */

export * from './rates'

export { NetClock } from './clock'
export type { ClockSample, ClockStats } from './clock'

export { NetBodyInterpolator } from './interpolation'

export { MAX_REWIND_MS as REWIND_CLAMP_MS } from './rates'
export { HISTORY_MS, RewindBuffer } from './rewind'
export type { Rewindable, Vec3 } from './rewind'

export { BitReader, BitWriter } from './codec/bits'
export { QUAT_BITS, QUAT_COMPONENT_BITS, SMALLEST_THREE_BOUND, dequantize, packQuaternion, quantize, unpackQuaternion } from './codec/quantize'
export type { Quat } from './codec/quantize'

export {
  ALL_SHIP_FIELDS, DEFAULT_SHIP_CODEC, ShipField, ShipFlags,
  changedFields, emptyShipState, readShipState, writeShipState,
} from './codec/ship-state'
export type { ShipCodecConfig, ShipState } from './codec/ship-state'

export { StaleBaselineError, baselineOf, buildSnapshot, decodeSnapshot, encodeSnapshot } from './codec/snapshot'
export type { Baseline, Snapshot } from './codec/snapshot'

export { InputButton, decodeInputPacket, emptyInputFrame, encodeInputPacket } from './codec/input'
export type { InputFrame, InputPacket } from './codec/input'

export { DEFAULT_SMOOTHING, ErrorSmoother, PendingInputs } from './prediction'
export type { Correction, CorrectionTier, SmoothingConfig } from './prediction'

export { acceptPacket, createSeat, drainInput, encodeFor, snapshotHistory } from './seats'
export type { Seat, SnapshotHistory } from './seats'

export { pongFor } from './room-clock'
export type { ClockPong } from './room-clock'

export { MessageType, decodeEvents, encodeEvents } from './channels'
export type { MessageKey, NetChannel } from './channels'
