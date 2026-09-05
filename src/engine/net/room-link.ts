/**
 * The client half of the netcode, shared by race and battle.
 *
 * Colyseus owns the socket, the reconnection and the schema state. This owns
 * the parts Colyseus has no opinion about, and which the architecture document
 * is entirely about:
 *
 * - **A clock.** Everything drawn for a remote ship happens on SERVER time.
 *   Without an estimate of it the interpolation clock drifts against the stream
 *   it is interpolating and every remote ship micro-stutters forever — which is
 *   the actual shape of "the game is jittery", not a physics problem.
 * - **An interpolation buffer.** Remote ships are rendered ~100 ms in the past,
 *   bracketed between the two snapshots around `serverNow() − delay`. A
 *   snapshot applied straight to a transform is what makes a clean 30 Hz stream
 *   look like a stuttering one.
 * - **An input pump.** Every packet carries every unacknowledged frame, so one
 *   dropped packet costs nothing.
 * - **A delta baseline.** The acknowledgement the server encodes against.
 *
 * It deliberately knows nothing about laps or weapons. Both modes send the same
 * input frame, receive the same bit-packed ship snapshot, and differ only in
 * the schema hanging off `state` and the events on the reliable channel.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { Client } from '@colyseus/sdk'
import {
  INTERP_DELAY_MS, NetBodyInterpolator, NetClock, PendingInputs, SNAPSHOT_HZ,
  StaleBaselineError, baselineOf, decodeSnapshot, encodeInputPacket,
} from '@crash-velocity/net'

import { fetchTicket } from './ticket'

import type { Room as ColyseusRoom } from '@colyseus/sdk'
import type { Baseline, InputFrame, ShipState, Snapshot } from '@crash-velocity/net'


const DEFAULT_PORT = 9003
const PING_EVERY   = 1000

// Events buffered before the oldest is dropped. A mode that stops draining
//  should not grow without bound.
const MAX_BUFFERED_EVENTS = 128

export const MessageKind = {
  INPUT:    'i',
  SNAPSHOT: 's',
  EVENTS:   'e',
  PING:     'p',
  PONG:     'q',
} as const

/**
 * Resolve the game server's URL.
 *
 * `?sv=` wins (a full `ws://…` or a bare port, for two clients on one laptop),
 * then the build-time variable, then the page's own host on the default port —
 * which is what `bun run dev:all` serves. `wss` when the page is `https`, or the
 * browser blocks the socket as mixed content.
 */
export function resolveServerUrl (override?: string): string {
  if (override) {
    if ((/^wss?:\/\//).test(override))
      return override
    if ((/^\d+$/).test(override))
      return `${protocol()}//${location.hostname}:${override}`
  }

  const configured = process.env.NEXT_PUBLIC_GAME_SERVER_URL
  if (configured)
    return configured

  return `${protocol()}//${location.hostname}:${DEFAULT_PORT}`
}

function protocol (): string {
  return typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss:' : 'ws:'
}

export type RemoteShip = {
  netIndex: number;
  interp:   NetBodyInterpolator;
  state:    ShipState;
}

export type NetStats = {
  rttMs:         number;
  jitterMs:      number;
  synced:        boolean;
  snapshotAgeMs: number;
  pending:       number;
  snapshotBytes: number;
  correctionM:   number;
}

export type JoinedMessage = {
  netIndex:     number;
  tickHz:       number;
  serverTick:   number;
  serverTimeMs: number;
}

export type RoomLinkOptions<TState> = {

  /** `race` or `battle` — the name the server registered. */
  room:    string;
  state:   new (...args: never[]) => TState;
  options: Record<string, unknown>;
  name?:   string;
  server?: string;
}

type PongType = { t0: number; serverTimeMs: number }

export class RoomLink<TState extends object, TEvent> {
  readonly clock = new NetClock()

  // The SDK's `Room` is generic over the SERVER room type as well as the state,
  // and we only ever have the second. `any` for the first is the SDK's own
  // fallback overload, not a shortcut.
  private room:      ColyseusRoom<any, TState> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null

  private readonly pending = new PendingInputs()
  private readonly remoteShips = new Map<number, RemoteShip>()
  private readonly respawnSeen = new Map<number, number>()
  private events: TEvent[] = []

  private baseline:   Baseline | null = null
  private newest:     Snapshot | null = null
  private localIndex = -1
  private snapshotHz = SNAPSHOT_HZ
  private lastBytes = 0
  private correctionM = 0
  private joinedInfo: JoinedMessage | null = null

  // Bridges the monotonic render clock to server wall-time, once. Everything
  //  after runs on `performance.now()`, which no NTP adjustment can move.
  private readonly epoch = Date.now() - performance.now()

  localNowMs (): number {
    return this.epoch + performance.now()
  }

  async connect (options: RoomLinkOptions<TState>): Promise<void> {
    const ticket = await fetchTicket(options.name)
    const client = new Client(resolveServerUrl(options.server))

    // The SDK sends `auth.token` as the request's bearer, which is what arrives
    // at the room's static `onAuth(token)`. There is no per-join auth argument.
    if (ticket?.ticket)
      client.auth.token = ticket.ticket

    this.room = await client.joinOrCreate<TState>(
      options.room,
      { ...options.options, name: ticket?.name ?? options.name },
      options.state as never,
    ) as unknown as ColyseusRoom<any, TState>

    this.room.onMessage('joined', (message: JoinedMessage) => {
      this.joinedInfo = message
      this.localIndex = message.netIndex
    })

    this.room.onMessage(MessageKind.SNAPSHOT, (payload: ArrayBuffer | Uint8Array) => this.applySnapshot(payload))

    this.room.onMessage(MessageKind.EVENTS, (list: TEvent[]) => {
      if (!Array.isArray(list))
        return

      this.events.push(...list)
      if (this.events.length > MAX_BUFFERED_EVENTS)
        this.events.splice(0, this.events.length - MAX_BUFFERED_EVENTS)
    })

    this.room.onMessage(MessageKind.PONG, (pong: PongType) => {
      this.clock.accept(pong.t0, pong.serverTimeMs, this.localNowMs())
    })

    const ping = () => this.room?.send(MessageKind.PING, this.localNowMs())
    ping()
    this.pingTimer = setInterval(ping, PING_EVERY)
  }

  close (): void {
    if (this.pingTimer)
      clearInterval(this.pingTimer)
    this.pingTimer = null

    void this.room?.leave()
    this.room = null

    this.pending.reset()
    this.remoteShips.clear()
    this.respawnSeen.clear()
    this.events     = []
    this.baseline   = null
    this.newest     = null
    this.localIndex = -1
    this.clock.reset()
  }

  // --- input ------------------------------------------------------------------

  // Stamp and queue a frame. The returned object is the one to predict with,
  //  so what the client simulated is bit-identical to what it sends.
  pushInput (frame: Omit<InputFrame, 'seq'>): InputFrame {
    return this.pending.push(frame)
  }

  // Send everything unacknowledged. Not just what changed — a `dirty` flag once
  //  sent a held throttle exactly once, and one dropped packet left the server
  //  driving on stale input indefinitely.
  flush (interpTick: number): void {
    if (!this.room)
      return

    this.room.send(MessageKind.INPUT, encodeInputPacket({
      frames:          [ ...this.pending.all ],
      lastAckSnapshot: this.newest?.serverTick ?? 0,
      interpTick,
    }))
  }

  unacknowledged (): readonly InputFrame[] {
    return this.pending.all
  }

  // --- state ------------------------------------------------------------------

  private applySnapshot (payload: ArrayBuffer | Uint8Array): void {
    const bytes    = payload instanceof ArrayBuffer ? new Uint8Array(payload) : payload
    this.lastBytes = bytes.byteLength

    let snapshot: Snapshot
    try {
      snapshot = decodeSnapshot(bytes, this.baseline)
    }
    catch (error) {
      // A delta against a baseline we no longer hold is undecodable, not
      // corrupt. Forgetting the baseline makes the next acknowledgement ask for
      // a full snapshot, which the server sends unprompted — so this heals
      // itself in one round trip rather than killing the room.
      if (error instanceof StaleBaselineError) {
        this.baseline = null
        return
      }
      throw error
    }

    this.baseline = baselineOf(snapshot)
    this.newest   = snapshot
    this.pending.acknowledge(snapshot.lastProcessedInput)

    for (const ship of snapshot.ships) {
      if (ship.id === this.localIndex)
        continue

      let remote = this.remoteShips.get(ship.id)
      if (!remote) {
        remote = { netIndex: ship.id, interp: new NetBodyInterpolator(), state: ship }
        this.remoteShips.set(ship.id, remote)
      }

      remote.state = ship

      // A teleport is signalled by `respawnIndex`, NEVER by an event. Blending
      // an interpolator across a relocation draws a ship streaking over the
      // arena, and inferring it from an event means a dropped event does it.
      const pose = [ ship.x, ship.y, ship.z, ship.qx, ship.qy, ship.qz, ship.qw ]
      if (this.respawnSeen.get(ship.id) !== ship.respawnIndex) {
        this.respawnSeen.set(ship.id, ship.respawnIndex)
        remote.interp.teleport(snapshot.serverTimeMs, pose)
      }
      else
        remote.interp.commit(snapshot.serverTimeMs, pose)
    }

    for (const id of snapshot.removed)
      this.drop(id)

    // A ship absent from a FULL snapshot is gone; a delta only lists what
    // changed, so absence there means nothing at all.
    if (snapshot.baselineTick === 0) {
      const present = new Set(snapshot.ships.map(s => s.id))
      for (const id of [ ...this.remoteShips.keys() ])
        if (!present.has(id))
          this.drop(id)
    }
  }

  private drop (netIndex: number): void {
    this.remoteShips.delete(netIndex)
    this.respawnSeen.delete(netIndex)
  }

  /**
   * The server time remote ships should be drawn at.
   *
   * One interpolation delay in the past, and never less than two snapshot
   * intervals — below that a single late packet empties the bracket.
   */
  renderTimeMs (): number {
    return this.clock.now(this.localNowMs()) - Math.max(INTERP_DELAY_MS, 2 * 1000 / this.snapshotHz)
  }

  remotes (): readonly RemoteShip[] {
    return [ ...this.remoteShips.values() ]
  }

  localShip (): ShipState | null {
    return this.newest?.ships.find(s => s.id === this.localIndex) ?? null
  }

  latest (): Snapshot | null {
    return this.newest
  }

  get state (): TState | null {
    return (this.room?.state as TState | undefined) ?? null
  }

  get sessionId (): string | null {
    return this.room?.sessionId ?? null
  }

  get netIndex (): number {
    return this.localIndex
  }

  get joined (): JoinedMessage | null {
    return this.joinedInfo
  }

  serverTick (): number {
    return this.newest?.serverTick ?? 0
  }

  drainEvents (): TEvent[] {
    const out   = this.events
    this.events = []
    return out
  }

  /** Reported by the prediction so the HUD can show how hard it is correcting. */
  noteCorrection (metres: number): void {
    this.correctionM = metres
  }

  stats (): NetStats {
    const clock = this.clock.stats
    return {
      rttMs:         clock.rttMs,
      jitterMs:      clock.jitterMs,
      synced:        clock.synced,
      snapshotAgeMs: this.newest ? Math.max(0, this.clock.peek(this.localNowMs()) - this.newest.serverTimeMs) : 0,
      pending:       this.pending.length,
      snapshotBytes: this.lastBytes,
      correctionM:   this.correctionM,
    }
  }
}
