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

import { Client, CloseCode } from '@colyseus/sdk'
import {
  INTERP_DELAY_MS, MessageKind, NetBodyInterpolator, NetClock, PendingInputs, RECONNECT_GRACE_SEC, SNAPSHOT_HZ,
  StaleBaselineError, baselineOf, decodeSnapshot, encodeInputPacket,
} from 'Ξ'

import { fetchTicket } from './ticket'

import type { Baseline, InputFrame, ShipState, Snapshot } from 'Ξ'


const DEFAULT_PORT = 9003
const PING_EVERY   = 1000

// Doubles from here on every failed attempt, capped below. Independent of
//  `RECONNECT_GRACE_SEC` — that one is shared with the server because it bounds
//  how LONG to keep trying; the server has no opinion on how fast.
const RECONNECT_INITIAL_DELAY_MS = 500
const RECONNECT_MAX_DELAY_MS     = 4000

// Events buffered before the oldest is dropped. A mode that stops draining
//  should not grow without bound.
const MAX_BUFFERED_EVENTS = 128

export { MessageKind }

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

/**
 * Turn a join failure into something a player can act on.
 *
 * Colyseus reports a refused socket as a bare `WebSocket connection failed`,
 * which tells a player nothing about which server was tried — and the URL is
 * the part that is usually wrong, since it falls back to the page's own host on
 * a fixed port when `NEXT_PUBLIC_GAME_SERVER_URL` is unset.
 */
function describeJoinFailure (error: unknown, url: string): string {
  const detail = error instanceof Error ? error.message : String(error)
  return `${detail || 'connection failed'} · ${url}`
}

export type RemoteShip = {
  netIndex: number;
  interp:   NetBodyInterpolator;
  state:    ShipState;
}

/**
 * Where the link is in its lifecycle.
 *
 * `reconnecting`/`lost` exist because `linkError` alone cannot distinguish "a
 * join that never landed" from "we WERE playing and the socket just dropped" —
 * the HUD reads very differently in each case, and only this says which one
 * it is.
 */
export type RoomLinkState = 'idle' | 'joining' | 'connected' | 'reconnecting' | 'lost'

export type NetStats = {
  rttMs:         number;
  jitterMs:      number;
  synced:        boolean;
  snapshotAgeMs: number;
  pending:       number;
  snapshotBytes: number;
  correctionM:   number;

  /**
   * Why the link is not up, or `null` while it is fine.
   *
   * Every mode is network-only now, so a join that never succeeds is not a
   * degraded game — it is no game at all. Without this the HUD cannot tell
   * "still handshaking" from "there is no server and there never will be",
   * and both render as a motionless ship.
   *
   * Kept exactly as it was for compatibility: it is `null` while a reconnect
   * is in progress (see `linkState`) and only names a reason once the link is
   * up-front unreachable or the reconnect loop below has given up.
   */
  linkError: string | null;

  /** See `RoomLinkState`. */
  linkState: RoomLinkState;

  /** Attempts made against the current drop. Reset the moment it heals. */
  reconnectAttempt: number;
}

export type JoinedMessage = {
  netIndex:     number;
  tickHz:       number;
  serverTick:   number;
  serverTimeMs: number;
}

/**
 * The minimal slice of a Colyseus room this class actually calls.
 *
 * Not the SDK's own `Room<T, State>` — that type is generic over the SERVER
 * room type we never have, and every signal on it (`onLeave` included) is a
 * callable object with `once`/`remove`/`clear` bolted on for the SDK's own
 * bookkeeping. Any object shaped like this is a room as far as `RoomLink` is
 * concerned, which is what lets a test hand it a plain object instead of a
 * socket.
 */
export type RoomLike<TState> = {
  readonly sessionId:         string;
  readonly reconnectionToken: string;
  readonly state:             TState;

  /** Present on the real SDK room; absent on a test's minimal fake. */
  reconnection?: { enabled: boolean };

  onMessage(type: string, callback: (payload: never) => void): void;
  onStateChange(callback: (state: TState) => void): void;
  onLeave(callback: (code: number, reason?: string) => void): void;
  send(type: string, payload?: unknown): void;
  leave(consented?: boolean): unknown;
}

/**
 * The minimal slice of the Colyseus `Client` this class actually calls.
 *
 * See `RoomLike` — same reason, and `RoomLinkOptions.clientFactory` is what
 * hands a test a fake satisfying this instead of the real socket-backed SDK
 * class.
 */
export type ClientLike<TState> = {
  auth: { token: string };
  joinOrCreate(room: string, options: Record<string, unknown>, state: new (...args: never[]) => TState): Promise<RoomLike<TState>>;
  reconnect(reconnectionToken: string, state: new (...args: never[]) => TState): Promise<RoomLike<TState>>;
}

export type RoomLinkOptions<TState> = {

  /** `race` or `battle` — the name the server registered. */
  room:    string;
  state:   new (...args: never[]) => TState;
  options: Record<string, unknown>;
  name?:   string;
  server?: string;

  /**
   * Builds the Colyseus client. Defaults to `new Client(url)`.
   *
   * A test supplies a fake here instead of mocking the whole SDK module, which
   * is what lets a reconnect sequence be driven frame by frame — fire the fake
   * room's `onLeave`, let fake timers advance the backoff, hand back a second
   * fake room — rather than through a real socket.
   */
  clientFactory?: (url: string) => ClientLike<TState>;
}

type PongType = { t0: number; serverTimeMs: number }

export class RoomLink<TState extends object, TEvent> {
  readonly clock = new NetClock()

  private client:         ClientLike<TState> | null = null
  private stateCtor:      (new (...args: never[]) => TState) | null = null
  private room:           RoomLike<TState> | null = null
  private pingTimer:      ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  private readonly pending = new PendingInputs()
  private readonly remoteShips = new Map<number, RemoteShip>()
  private remoteList: readonly RemoteShip[] = []
  private readonly respawnSeen = new Map<number, number>()
  private events:     TEvent[] = []

  private baseline:   Baseline | null = null
  private newest:     Snapshot | null = null
  private localIndex = -1
  private snapshotHz = SNAPSHOT_HZ
  private lastBytes = 0
  private correctionM = 0
  private joinedInfo: JoinedMessage | null = null
  private linkError:  string | null = null
  private linkState:  RoomLinkState = 'idle'
  private reconnectAttempt = 0
  private closing = false
  private schemaVersion = 0

  // Bridges the monotonic render clock to server wall-time, once. Everything
  //  after runs on `performance.now()`, which no NTP adjustment can move.
  private readonly epoch = Date.now() - performance.now()

  localNowMs (): number {
    return this.epoch + performance.now()
  }

  /**
   * Join the room, or record why we could not.
   *
   * This resolves either way and never rejects. Both transports call it as
   * fire-and-forget — there is nothing useful for a scene to `await`, since the
   * scene has to render whether or not the socket ever opens — and a rejecting
   * promise behind a `void` is an unhandled rejection that reaches nobody. The
   * failure goes into `stats().linkError` instead, which both HUDs already poll
   * every frame.
   */
  async connect (options: RoomLinkOptions<TState>): Promise<void> {
    this.closing   = false
    this.linkState = 'joining'
    try {
      await this.open(options)
      this.linkError = null
      this.linkState = 'connected'
    }
    catch (error) {
      this.linkError = describeJoinFailure(error, resolveServerUrl(options.server))
      // Never connected in the first place — distinct from `lost`, which only
      //  follows a drop that happened after a join actually landed.
      this.linkState = 'idle'
      console.error('[net] join failed:', error)
    }
  }

  private async open (options: RoomLinkOptions<TState>): Promise<void> {
    const ticket = await fetchTicket(options.name)
    const url    = resolveServerUrl(options.server)
    const client = options.clientFactory ? options.clientFactory(url) : new Client(url) as unknown as ClientLike<TState>

    // The SDK sends `auth.token` as the request's bearer, which is what arrives
    // at the room's static `onAuth(token)`. There is no per-join auth argument.
    if (ticket?.ticket)
      client.auth.token = ticket.ticket

    this.client    = client
    this.stateCtor = options.state

    const room = await client.joinOrCreate(
      options.room,
      { ...options.options, name: ticket?.name ?? options.name },
      options.state,
    )
    this.bindRoom(room)
  }

  /**
   * Register every handler the link needs against ONE room object, and turn
   * off the SDK's own transparent retry.
   *
   * Runs after the initial join and again after every successful
   * `client.reconnect()` — a reconnect hands back a brand-new `Room` with an
   * empty handler registry of its own, so nothing carries over from the one it
   * replaces. The `joined` message is the one exception: the server only ever
   * sends it from `onJoin`, which Colyseus does not call again on a
   * reconnection, so `joinedInfo`/`localIndex` are simply never overwritten —
   * there is nothing to preserve on purpose here, just nothing that touches
   * them.
   *
   * Colyseus 0.18 rooms retry a drop internally (`room.reconnection`), keyed
   * off the raw close code, for up to 15 attempts capped at 5 s apart —
   * several times longer than `RECONNECT_GRACE_SEC`, and it only reaches
   * `onLeave` once it finally gives up. Disabling it is what makes `onLeave`
   * fire on the FIRST drop, with the real close code, so `handleLeave` below
   * is the only retry loop running and its timing actually matches how long
   * the server holds the seat.
   */
  private bindRoom (room: RoomLike<TState>): void {
    this.room = room
    if (room.reconnection)
      room.reconnection.enabled = false

    room.onMessage('joined', (message: JoinedMessage) => {
      this.joinedInfo = message
      this.localIndex = message.netIndex
    })

    // Colyseus mutates one Schema object in place. A monotonically increasing
    // patch version lets mode transports rebuild their joined indexes exactly
    // when that object changes, without scanning a roster during every frame.
    room.onStateChange(() => this.schemaVersion++)

    room.onMessage(MessageKind.SNAPSHOT, (payload: ArrayBuffer | Uint8Array) => this.applySnapshot(payload))

    room.onMessage(MessageKind.EVENTS, (list: TEvent[]) => {
      if (!Array.isArray(list))
        return

      this.events.push(...list)
      if (this.events.length > MAX_BUFFERED_EVENTS)
        this.events.splice(0, this.events.length - MAX_BUFFERED_EVENTS)
    })

    room.onMessage(MessageKind.PONG, (pong: PongType) => {
      this.clock.accept(pong.t0, pong.serverTimeMs, this.localNowMs())
    })

    room.onLeave((code, reason) => this.handleLeave(code, reason))

    this.restartPing()
  }

  private restartPing (): void {
    if (this.pingTimer)
      clearInterval(this.pingTimer)

    const ping = () => this.room?.send(MessageKind.PING, this.localNowMs())
    ping()
    this.pingTimer = setInterval(ping, PING_EVERY)
  }

  /**
   * A drop, or our own leave coming back around.
   *
   * `closing` is the reliable half of this check: it is set synchronously by
   * `close()` before it ever touches the socket, so it catches a consented
   * leave regardless of which code the server ends up reporting for it. The
   * `CloseCode.CONSENTED` comparison is belt and suspenders for a consented
   * leave this class did not itself initiate (there is none today, but
   * nothing stops a future caller from adding one). Anything else is a real
   * drop — including a code this class has never seen before, since a server
   * restart or a proxy timeout owes us no particular number.
   */
  private handleLeave (code: number, reason?: string): void {
    if (this.closing || code === CloseCode.CONSENTED || this.linkState === 'reconnecting')
      return

    this.linkState        = 'reconnecting'
    this.reconnectAttempt = 0
    this.scheduleReconnect(Date.now(), reason)
  }

  /**
   * Wait, then try. Doubles the wait each time, up to `RECONNECT_MAX_DELAY_MS`,
   * until a reconnect lands or `RECONNECT_GRACE_SEC` has elapsed since the
   * drop — trying past that can only ever find the seat gone, since that is
   * the same number the room calls `allowReconnection` with.
   */
  private scheduleReconnect (droppedAt: number, reason?: string): void {
    if (this.closing)
      return

    if (Date.now() - droppedAt >= RECONNECT_GRACE_SEC * 1000) {
      this.linkState = 'lost'
      this.linkError = `LINK LOST · ${reason || 'timed out'}`
      return
    }

    this.reconnectAttempt++

    const delay = Math.min(
      RECONNECT_MAX_DELAY_MS,
      RECONNECT_INITIAL_DELAY_MS * 2 ** (this.reconnectAttempt - 1)
    )

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.tryReconnect(droppedAt, reason)
    }, delay)
  }

  private async tryReconnect (droppedAt: number, reason?: string): Promise<void> {
    const client    = this.client
    const room      = this.room
    const stateCtor = this.stateCtor
    if (!client || !room || !stateCtor)
      return

    try {
      const nextRoom = await client.reconnect(room.reconnectionToken, stateCtor)
      if (this.closing)
        return

      // Forces the existing `StaleBaselineError` path to heal with a full
      // snapshot next delta: the reconnected room's seat was never torn down
      // (see `packages/net/src/seats.ts`), but this client's own memory of
      // what it last acknowledged is worth throwing away rather than trusting
      // a baseline tick the gap in the middle makes meaningless to compare.
      this.baseline = null
      this.newest   = null
      this.bindRoom(nextRoom)

      this.linkState        = 'connected'
      this.linkError        = null
      this.reconnectAttempt = 0

      // Deliberately NOT `this.pending.reset()`. The server's seat keeps its
      // `highestSeq` across the gap — it is only deleted once the grace window
      // in the room's own `onLeave` expires — so resetting the local ring's
      // sequence counter back to 0 would make every future frame look
      // already-applied to `acceptPacket`, and the server would silently stop
      // accepting input for good. Whatever is still unacknowledged just goes
      // out on the next `flush()`, exactly as it would after any dropped packet.
    }
    catch {
      this.scheduleReconnect(droppedAt, reason)
    }
  }

  /**
   * Cancel everything in flight and let go of the room. Idempotent: a second
   * call finds nothing left to cancel and no room left to leave.
   */
  close (): void {
    this.closing = true

    if (this.pingTimer)
      clearInterval(this.pingTimer)
    this.pingTimer = null

    if (this.reconnectTimer)
      clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null

    void this.room?.leave()
    this.room   = null
    this.client = null

    this.pending.reset()
    this.remoteShips.clear()
    this.remoteList = []
    this.respawnSeen.clear()
    this.events           = []
    this.baseline         = null
    this.newest           = null
    this.localIndex       = -1
    this.linkError        = null
    this.linkState        = 'idle'
    this.reconnectAttempt = 0
    this.schemaVersion    = 0
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
        this.remoteList = [ ...this.remoteShips.values() ]
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
    if (this.remoteShips.delete(netIndex))
      this.remoteList = [ ...this.remoteShips.values() ]
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
    return this.remoteList
  }

  localShip (): ShipState | null {
    return this.newest?.ships.find(s => s.id === this.localIndex) ?? null
  }

  latest (): Snapshot | null {
    return this.newest
  }

  get state (): TState | null {
    return this.room?.state ?? null
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

  get stateVersion (): number {
    return this.schemaVersion
  }

  serverTick (): number {
    return this.newest?.serverTick ?? 0
  }

  /**
   * The newest input frame the server has applied.
   *
   * The join between a snapshot and the client's own prediction history: the
   * pose in that snapshot is the answer to THIS frame, so it is the frame the
   * prediction has to be compared at. Zero until the first snapshot lands.
   */
  serverAck (): number {
    return this.newest?.lastProcessedInput ?? 0
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
      rttMs:            clock.rttMs,
      jitterMs:         clock.jitterMs,
      synced:           clock.synced,
      snapshotAgeMs:    this.newest ? Math.max(0, this.clock.peek(this.localNowMs()) - this.newest.serverTimeMs) : 0,
      pending:          this.pending.length,
      snapshotBytes:    this.lastBytes,
      correctionM:      this.correctionM,
      linkError:        this.linkError,
      linkState:        this.linkState,
      reconnectAttempt: this.reconnectAttempt,
    }
  }
}
