/**
 * Per-socket state and the guards that go with it.
 *
 * A socket is anonymous until it sends a valid `join`, so everything here is
 * nullable on purpose: the connection exists before it has a player, and it
 * must survive a client that opens a socket and then says nothing, or says
 * something hostile.
 */

import type { BattleRoom, RoomClient } from '../match/room'


export type SocketKind = 'battle' | 'lobby'

export type SocketData = {
  kind: SocketKind;

  /** Set by a successful `join`; null while the socket is anonymous. */
  room:   BattleRoom | null;
  client: RoomClient | null;

  /** Requested at upgrade time from the query string. */
  roomId: string;

  bucket: RateBucket;
}

/**
 * A token bucket, sized for the 60 Hz input pump plus reliable traffic.
 *
 * Not anti-cheat — it is there so one broken or malicious tab cannot spend the
 * whole room's tick budget parsing its packets. Refusals close the socket
 * rather than dropping quietly, because a client that trips this is broken and
 * silence would leave it flying blind.
 */
export type RateBucket = {
  tokens:     number;
  lastFillMs: number;
}

const BURST      = 240
const PER_SECOND = 120

export function createBucket (now: number): RateBucket {
  return { tokens: BURST, lastFillMs: now }
}

export function takeToken (bucket: RateBucket, now: number): boolean {
  const elapsed     = Math.max(0, now - bucket.lastFillMs) / 1000
  bucket.lastFillMs = now
  bucket.tokens     = Math.min(BURST, bucket.tokens + elapsed * PER_SECOND)

  if (bucket.tokens < 1)
    return false

  bucket.tokens -= 1
  return true
}

/** Largest frame accepted, before parsing. Caps the work a junk packet can cost. */
export const MAX_MESSAGE_BYTES = 16 * 1024

/**
 * Origin check for the WebSocket upgrade.
 *
 * An empty allowlist means "any origin", which is what a local dev run and a
 * LAN game both want; a configured list is what a deployment sets. Browsers do
 * not enforce CORS on WebSockets, so without this a page anywhere could open a
 * socket against a public server.
 */
export function originAllowed (origin: string | null, allowlist: string[]): boolean {
  if (allowlist.length === 0)
    return true
  if (!origin)
    return false
  return allowlist.includes(origin)
}
