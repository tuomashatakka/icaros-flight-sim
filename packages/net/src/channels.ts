/**
 * Two lanes over one socket.
 *
 * The architecture document splits traffic in two: input frames, state
 * snapshots and clock pings are unreliable — losing one is harmless because
 * the next supersedes it, and they must never block anything behind them —
 * while joins, fire events, hits, respawns and match transitions are
 * reliable-ordered.
 *
 * Colyseus rides WebSocket, which is TCP, so there is no genuinely unreliable
 * lane to send on. What this interface buys is the *behaviour*: a receiver that
 * discards a snapshot older than one it already has gets the semantics that
 * matter (never act on stale state) without the transport. The seam is here so
 * that swapping in `@colyseus/h3-transport` — WebTransport, real unreliable
 * datagrams — is a constructor change rather than a rewrite.
 */

import { pack, unpack } from 'msgpackr'


/** Message keys. Single characters: Colyseus puts the key on every message. */
export const MessageType = {
  /** C→S, unreliable-ish: the bundled input packet. Binary. */
  INPUT:    'i',
  /** S→C, unreliable-ish: the delta-compressed snapshot. Binary. */
  SNAPSHOT: 's',
  /** S→C, reliable-ordered: gameplay events. MessagePack. */
  EVENTS:   'e',
  /** C→S, reliable-ordered: a fire request. MessagePack. */
  FIRE:     'f',
  /** Both ways, unreliable-ish: clock synchronisation. */
  PING:     'p',
  PONG:     'q',
  /** C→S, dev only. */
  DEV:      'd',
} as const

export type MessageKey = typeof MessageType[keyof typeof MessageType]

export interface NetChannel {
  sendReliable (key: MessageKey, payload: unknown): void
  sendUnreliable (key: MessageKey, payload: Uint8Array): void
  onMessage (key: MessageKey, handler: (payload: never) => void): void
}

/**
 * Reliable events go through MessagePack rather than the bit-packer.
 *
 * They are rare, variably shaped, and not worth hand-writing a serialiser for —
 * which is exactly the split the document recommends. `msgpackr` is already in
 * the tree as a Colyseus dependency, so this costs nothing to adopt.
 */
export function encodeEvents (events: readonly unknown[]): Uint8Array {
  return pack(events)
}

export function decodeEvents<T> (payload: Uint8Array | ArrayBuffer): T[] {
  const bytes = payload instanceof ArrayBuffer ? new Uint8Array(payload) : payload
  const value = unpack(bytes)
  return Array.isArray(value) ? value as T[] : []
}
