/**
 * Per-connection input bookkeeping, and the baseline history snapshots are
 * delta-encoded against.
 *
 * Both live here rather than in a mode's room because neither is about racing
 * or fighting — they are about a client that re-sends its unacknowledged input
 * every tick and acknowledges snapshots out of order. Two copies of this logic
 * would be two places to get the self-healing wrong.
 */

import { SNAPSHOT_HZ } from './rates'
import { baselineOf, encodeSnapshot } from './codec/snapshot'

import type { Baseline, Snapshot } from './codec/snapshot'
import type { InputFrame, InputPacket } from './codec/input'


/**
 * Frames drained per tick when the queue is running long.
 *
 * Two, not "all of them": draining the whole queue would let a client that
 * bundled a second of input fast-forward its ship. One at a time would let the
 * buffer grow without bound. Two converges without ever handing out a speed
 * advantage.
 */
const DRAIN_WHEN_LONG = 2
const TARGET_BUFFER   = 2
const MAX_BUFFER      = 16

export type Seat = {
  playerId:           string;
  netIndex:           number;
  queue:              InputFrame[];
  highestSeq:         number;
  lastProcessedInput: number;
  lastAckSnapshot:    number;
  interpTick:         number;

  /** The last frame applied. Repeated when the queue runs dry — see `drainInput`. */
  lastApplied: InputFrame | null;
}

export function createSeat (playerId: string, netIndex: number): Seat {
  return {
    playerId,
    netIndex,
    queue:              [],
    highestSeq:         0,
    lastProcessedInput: 0,
    lastAckSnapshot:    0,
    interpTick:         0,
    lastApplied:        null,
  }
}

/**
 * Take a packet's frames, keeping only what is new.
 *
 * Every packet re-sends the unacknowledged tail, so most frames here have
 * already been queued. Discarding by sequence is what makes the resend
 * self-healing rather than a stutter of duplicates.
 */
export function acceptPacket (seat: Seat, packet: InputPacket): void {
  seat.lastAckSnapshot = packet.lastAckSnapshot
  seat.interpTick      = packet.interpTick

  for (const frame of packet.frames) {
    if (frame.seq <= seat.highestSeq)
      continue

    seat.highestSeq = frame.seq
    seat.queue.push(frame)
  }

  // Overflow drops the OLDEST: it is the one most likely already superseded,
  // and the newest is the one the player can feel.
  while (seat.queue.length > MAX_BUFFER)
    seat.queue.shift()
}

/**
 * The frames to apply this tick.
 *
 * An empty queue REPEATS the last frame rather than going neutral. An empty
 * queue means a packet was late, not that the pilot let go of everything —
 * treating it as neutral makes a dropped packet feel like a stall.
 */
export function drainInput (seat: Seat): InputFrame[] {
  const take              = seat.queue.length > TARGET_BUFFER ? DRAIN_WHEN_LONG : 1
  const out: InputFrame[] = []

  for (let i = 0; i < take && seat.queue.length > 0; i++) {
    const frame             = seat.queue.shift()!
    seat.lastProcessedInput = frame.seq
    seat.lastApplied        = frame
    out.push(frame)
  }

  if (out.length === 0 && seat.lastApplied)
    out.push(seat.lastApplied)

  return out
}


// --- baselines ---------------------------------------------------------------

/** A second of history at the snapshot rate — comfortably past any live ack. */
const HISTORY = SNAPSHOT_HZ

export type SnapshotHistory = {
  push (snapshot: Snapshot): void;
  baselineAt (tick: number): Baseline | null;
}

export function snapshotHistory (): SnapshotHistory {
  const baselines: Baseline[] = []

  return {
    push (snapshot) {
      baselines.push(baselineOf(snapshot))
      if (baselines.length > HISTORY)
        baselines.shift()
    },

    baselineAt (tick) {
      return tick <= 0 ? null : baselines.find(b => b.tick === tick) ?? null
    },
  }
}

/**
 * Encode one client's copy of a snapshot.
 *
 * `cache` is keyed by baseline AND by the client's input acknowledgement, which
 * both live in the header. Sixteen clients sitting on the same acknowledgement
 * — the normal case — pay for one encode between them; two clients with
 * different acks correctly get different buffers rather than one reading the
 * other's.
 */
export function encodeFor (
  snapshot: Snapshot,
  seat: Seat,
  history: SnapshotHistory,
  cache: Map<number, Uint8Array>,
): Uint8Array {
  const baseline = history.baselineAt(seat.lastAckSnapshot)
  const against  = baseline?.tick ?? 0
  const key      = against * 2 ** 21 + (seat.lastProcessedInput & 0x1fffff)

  const hit = cache.get(key)
  if (hit)
    return hit

  const bytes = encodeSnapshot({ ...snapshot, baselineTick: against, lastProcessedInput: seat.lastProcessedInput }, baseline)
  cache.set(key, bytes)
  return bytes
}
