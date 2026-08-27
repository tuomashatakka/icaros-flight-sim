/**
 * The battle wire protocol.
 *
 * ONE definition, imported by both halves: the browser transport
 * (`Δengine/battle/transport`) and the Bun game server (`packages/server`).
 * The previous transport hand-typed its own mirror of a server that was never
 * written, which is exactly how a protocol drifts from the thing that produced
 * it — so the state packet embeds `BattleSnapshot` and the input frames embed
 * `BattleInput` straight from `Δengine/battle/types`, and cannot disagree with
 * the sim by construction.
 *
 * Client → server messages carry zod schemas. The server parses every inbound
 * frame through them: a socket is an untrusted input, and `JSON.parse` alone
 * would let a malformed packet reach `sim.setInput` and poison a live match.
 * Server → client messages are types only — the client trusts its server, and
 * validating 30 snapshots a second would cost more than it protects.
 */

import { z } from 'zod'
import { BATTLE_TEAMS } from './arena'
import { WEAPON_IDS } from './weapons'
import { SHIP_IDS } from 'Δlib/ship/registry'
import type { BattleTeam } from './arena'
import type { Loadout, WeaponId } from './weapons'
import type { BattleEvent, BattleInput, BattleSnapshot, BattleStatus } from './types'
import type { ShipId } from 'Δlib/ship/registry'


/**
 * Bumped on any breaking shape change. The server refuses a mismatched join
 * rather than letting a stale tab decode garbage for the rest of a match.
 */
export const PROTOCOL_VERSION = 1

/** Server simulation tick. Monotonic from room start, never wall-clock. */
export type Tick = number

export type PlayerId = string

// ---------------------------------------------------------------- validators

/**
 * Membership tests against the runtime id arrays rather than a hand-written
 * `z.enum`, so adding a ship or a weapon cannot leave the protocol behind.
 */
const shipIdSchema = z.string().refine(
  (value): value is ShipId => (SHIP_IDS as readonly string[]).includes(value),
  { message: 'unknown ship id' }
)

const weaponIdSchema = z.string().refine(
  (value): value is WeaponId => (WEAPON_IDS as readonly string[]).includes(value),
  { message: 'unknown weapon id' }
)

const teamSchema = z.string().refine(
  (value): value is BattleTeam => (BATTLE_TEAMS as readonly string[]).includes(value),
  { message: 'unknown team' }
)

const loadoutSchema = z.object({
  primary:   weaponIdSchema,
  secondary: weaponIdSchema,
})

/**
 * Axes are clamped rather than rejected. A client sending 900 for `steer` is
 * either broken or hostile, and in both cases the match is better served by
 * treating it as full lock than by dropping the packet and freezing that ship.
 */
const axis = z.number().finite()
  .catch(0)
  .transform(v => Math.max(-1, Math.min(1, v)))

/** Sequence numbers and ticks: monotonic, never negative, never fractional. */
const counter = z.int().nonnegative()

// ---------------------------------------------------------------- client → server

/**
 * One tick of local input, tagged with the sequence number the reconciliation
 * loop acknowledges against.
 */
export type InputFrame = BattleInput & {
  seq:        number;
  clientTick: Tick;
}

export const inputFrameSchema = z.object({
  seq:           counter,
  clientTick:    counter,
  steer:         axis,
  throttle:      z.boolean(),
  brake:         z.boolean(),
  boost:         z.boolean(),
  fire:          z.boolean(),
  fireSecondary: z.boolean().optional(),
  reverse:       z.boolean().optional(),
  strafe:        axis.optional(),
  aimPitch:      axis.optional(),
  resetSeq:      counter,
})

/**
 * Every input frame the client has not seen acknowledged, newest last.
 *
 * The bundle is the whole point. The previous transport sent a frame only when
 * its `dirty` flag was set, so a held throttle went out ONCE — and a single
 * dropped packet left the server driving on stale controls until the player
 * moved a stick again. Re-sending the unacknowledged tail makes loss
 * self-healing at the cost of a few dozen bytes.
 */
export type InputPacket = {
  type:            'input';
  frames:          InputFrame[];
  lastAckSnapshot: Tick;

  /**
   * The server tick this client was rendering remote ships at when these
   * inputs were sampled. Lag compensation rewinds hitboxes to it, so a shot
   * resolves against what the shooter actually saw.
   */
  interpTick: Tick;
}

/** Bundles are capped so a client cannot force unbounded replay work. */
export const MAX_INPUT_FRAMES = 32

export const inputPacketSchema = z.object({
  type:   z.literal('input'),
  frames: z.array(inputFrameSchema).min(1)
    .max(MAX_INPUT_FRAMES),
  lastAckSnapshot: counter,
  interpTick:      counter,
})

export type JoinRequest = {
  type:     'join';
  protocol: number;
  name:     string;
  shipId:   ShipId;
  loadout?: Loadout;

  /** Issued by the lobby on match start; absent for a direct join. */
  ticket?: string;

  /** Resume token from a previous connection, for the reconnect grace window. */
  session?: string;
}

export const joinRequestSchema = z.object({
  type:     z.literal('join'),
  protocol: z.number().int(),
  name:     z.string().min(1)
    .max(24),
  shipId:  shipIdSchema,
  loadout: loadoutSchema.optional(),
  ticket:  z.string().max(128)
    .optional(),
  session: z.string().max(128)
    .optional(),
})

export type LeaveRequest = { type: 'leave' }

export const leaveRequestSchema = z.object({ type: z.literal('leave') })

/** Clock sync. `t0` is echoed verbatim so the client can match reply to send. */
export type PingMessage = { type: 'ping'; t0: number }

export const pingSchema = z.object({
  type: z.literal('ping'),
  t0:   z.number().finite(),
})

/**
 * Dev-only match manipulation, the network replacement for what
 * `window.__devBattle.place()` and `.face()` used to do by poking a local sim.
 * The server ignores these entirely unless it was started with
 * `DEV_COMMANDS=1`, so shipping one changes nothing in production.
 */
export type DevCommand =
  | { type: 'dev'; cmd: 'place'; id?: PlayerId; x: number; y: number; z: number } |
  { type: 'dev'; cmd: 'face'; x: number; z: number } |
  { type: 'dev'; cmd: 'status'; status: BattleStatus }

export const devCommandSchema = z.discriminatedUnion('cmd', [
  z.object({
    type: z.literal('dev'),
    cmd:  z.literal('place'),
    id:   z.string().max(64)
      .optional(),
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite(),
  }),
  z.object({
    type: z.literal('dev'),
    cmd:  z.literal('face'),
    x:    z.number().finite(),
    z:    z.number().finite(),
  }),
  z.object({
    type:   z.literal('dev'),
    cmd:    z.literal('status'),
    status: z.enum([ 'lobby', 'countdown', 'live', 'finished' ]),
  }),
])

export type ClientMessage = InputPacket | JoinRequest | LeaveRequest | PingMessage | DevCommand

export const clientMessageSchema = z.discriminatedUnion('type', [
  inputPacketSchema,
  joinRequestSchema,
  leaveRequestSchema,
  pingSchema,
  devCommandSchema,
])

// ---------------------------------------------------------------- server → client

/** Everything the client needs to start rendering on server time. */
export type JoinAccept = {
  type:       'joined';
  protocol:   number;
  playerId:   PlayerId;
  name:       string;
  team:       BattleTeam;
  shipId:     ShipId;
  status:     BattleStatus;
  serverTick: Tick;

  /** Server clock at send, the seed for the client's offset estimate. */
  serverTimeMs: number;

  // Sim rate and broadcast rate, so the client derives its own interpolation
  //  delay instead of hard-coding one that silently rots when the server
  //  retunes.
  tickHz:     number;
  snapshotHz: number;

  /** Resume token for the reconnect grace window. */
  session: string;

  arenaId: string;
}

/**
 * The authoritative world, broadcast on the snapshot cadence.
 *
 * `snapshot` is nested rather than spread onto the envelope (as the dead
 * transport did) so envelope fields can never collide with sim fields.
 */
export type StateMessage = {
  type:         'state';
  serverTick:   Tick;
  serverTimeMs: number;

  // Reserved for phase 6 delta encoding; equals `serverTick` while full
  //  snapshots are sent.
  baselineTick: Tick;

  // Highest `InputFrame.seq` from THIS client already folded into the sim.
  //  Reconciliation discards everything at or below it and replays the rest.
  lastProcessedInput: number;

  snapshot: BattleSnapshot;
}

export type EventsMessage = { type: 'events'; list: BattleEvent[] }

export type RosterEntry = {
  id:     PlayerId;
  name:   string;
  team:   BattleTeam;
  isBot:  boolean;
  shipId: ShipId;
  kills:  number;
  deaths: number;
}

export type RosterMessage = { type: 'roster'; players: RosterEntry[] }

export type QueuedMessage = { type: 'queued'; status: BattleStatus }

export type PongMessage = {
  type:         'pong';
  t0:           number;
  serverTimeMs: number;
  serverTick:   Tick;
}

export type ErrorCode =
  | 'protocol-mismatch' |
  'bad-message' |
  'room-full' |
  'no-such-room' |
  'bad-ticket' |
  'rate-limited' |
  'shutting-down'

export type ErrorMessage = { type: 'error'; code: ErrorCode; message: string }

export type ServerMessage =
  | JoinAccept | StateMessage | EventsMessage | RosterMessage |
  QueuedMessage | PongMessage | ErrorMessage

// ---------------------------------------------------------------- codec

/**
 * The single seam for a future binary wire.
 *
 * Phase 6 of the netcode plan replaces JSON with bit-packed snapshots
 * (smallest-three quaternions, quantised positions). Everything above is shaped
 * so that swap is this one interface and nothing else.
 */
export interface Codec {
  readonly name: string
  encode (message: ServerMessage | ClientMessage): string
  decode (raw: string | ArrayBuffer | Uint8Array): unknown
}

const decoder = new TextDecoder()

export const jsonCodec: Codec = {
  name: 'json',

  encode (message) {
    return JSON.stringify(message)
  },

  decode (raw) {
    if (typeof raw === 'string')
      return JSON.parse(raw)
    return JSON.parse(decoder.decode(raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw))
  },
}

/**
 * Decode and validate one inbound client frame.
 *
 * Returns a discriminated result rather than throwing: a bad packet is a
 * routine event on a public socket, not an exception, and the caller answers it
 * with an `ErrorMessage` instead of unwinding the room's tick.
 */
export type ParseResult =
  | { ok: true; message: ClientMessage } |
  { ok: false; reason: string }

export function parseClientMessage (raw: string | ArrayBuffer | Uint8Array, codec: Codec = jsonCodec): ParseResult {
  let decoded: unknown
  try {
    decoded = codec.decode(raw)
  }
  catch {
    return { ok: false, reason: 'malformed payload' }
  }

  const parsed = clientMessageSchema.safeParse(decoded)
  if (!parsed.success)
    return { ok: false, reason: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }

  return { ok: true, message: parsed.data as ClientMessage }
}

/**
 * Strip the transport fields off an input frame, leaving what the sim accepts.
 * Keeps `seq`/`clientTick` out of `BattlePlayer.controls`, where they would be
 * dead weight replayed through `stepHovercraft` every tick.
 */
export function toBattleInput (frame: InputFrame): BattleInput {
  return {
    steer:         frame.steer,
    throttle:      frame.throttle,
    brake:         frame.brake,
    boost:         frame.boost,
    fire:          frame.fire,
    fireSecondary: frame.fireSecondary,
    reverse:       frame.reverse,
    strafe:        frame.strafe,
    aimPitch:      frame.aimPitch,
    resetSeq:      frame.resetSeq,
  }
}
