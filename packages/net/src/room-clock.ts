/**
 * The PING/PONG clock handshake, identical for every mode's room.
 *
 * A room's reply has to be byte-for-byte the same whether it comes from race
 * or battle: the client's `NetClock` samples round-trip time and offset from
 * this shape with no idea which game it is talking to, so the two modes
 * drifting apart here would only ever show up as a clock bug on whichever one
 * changed. What still differs per mode is what "the current tick" even is —
 * `RaceSim.tick` versus a room-owned counter — so that stays a callback rather
 * than something this module tries to own.
 */

export type ClockPong = {
  t0:           number;
  serverTimeMs: number;
  serverTick:   number;
}

/**
 * Build a room's PONG reply to a client's PING.
 *
 * `nowMs` defaults to the wall clock, so every real caller is unaffected; a
 * test injects a fixed value so the reply is assertable without depending on
 * `Date.now()`.
 */
export function pongFor (t0: number, serverTick: number, nowMs: number = Date.now()): ClockPong {
  return { t0, serverTimeMs: nowMs, serverTick }
}
