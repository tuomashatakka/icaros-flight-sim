import { useBattleStore } from 'Δhooks/use-battle-store'
import { NetBodyInterpolator } from '../interpolation-network'
import { NetClock } from './net-clock'
import { MAX_INPUT_FRAMES, PROTOCOL_VERSION, jsonCodec } from './protocol'
import type { BattleTeam } from './arena'
import type { BattleEvent, BattleInput, BattleSnapshot } from './types'
import type { Loadout } from './weapons'
import type { ShipId } from 'Δlib/ship/registry'
import type {
  InputFrame,
  PlayerId,
  ServerMessage,
  SnapshotPlayer,
  StateMessage,
  Tick,
} from './protocol'


/** The port `packages/server` listens on by default. */
const DEFAULT_PORT = 9003

/** How often the clock-sync exchange runs, in ms. */
const PING_EVERY = 1_000

/**
 * HUD commit interval, ms.
 *
 * Chrome (scores, timers, zone state) changes far slower than 30 Hz, and every
 * commit is a React render. The previous transport throttled on a packet
 * COUNT, which silently changed meaning with the snapshot rate; time is what
 * was actually meant.
 */
const CHROME_EVERY = 100

/**
 * Events held between drains.
 *
 * A backgrounded tab stops ticking but keeps receiving, so this bounds what one
 * long stall can accumulate. Oldest go first: a kill feed catching up beats one
 * replaying a minute of history.
 */
const MAX_BUFFERED_EVENTS = 128

/** Shared empty result, so the common no-events tick allocates nothing. */
const EMPTY_EVENTS: BattleEvent[] = []

/** Reconnect backoff, ms. Capped so a server restart is picked up quickly. */
const BACKOFF = [ 250, 500, 1_000, 2_000, 4_000 ]

export type NetRemote = {
  id:     PlayerId;
  team:   BattleTeam;
  name:   string;
  interp: NetBodyInterpolator;

  /** Newest authoritative fields, for nameplates and lock carets. */
  state: SnapshotPlayer;
}

export type NetStats = {
  rttMs:    number;
  jitterMs: number;
  synced:   boolean;

  /** Age of the newest snapshot in server time, ms. Climbs when the feed stalls. */
  snapshotAgeMs: number;

  /** Distance the last reconciliation moved the predicted ship, metres. */
  correctionM: number;

  /** Unacknowledged input frames in flight. */
  pending: number;
}

export type ConnectOptions = {
  name:     string;
  shipId:   ShipId;
  loadout?: Loadout;

  /** Room to join; the server picks its default when omitted. */
  match?: string;

  /** Explicit override, else `NEXT_PUBLIC_BATTLE_SERVER_URL`, else localhost. */
  url?: string;
}

/**
 * Resolve the game server URL.
 *
 * Three sources, most specific first: an explicit override (the `?sv=` dev
 * escape hatch the old transport documented but never implemented), the build's
 * `NEXT_PUBLIC_BATTLE_SERVER_URL`, and finally the page's own host on the
 * default port — which is what a `bun run dev:all` session wants with no
 * configuration at all.
 */
export function resolveServerUrl (override?: string): string {
  if (override)
    return (/^wss?:\/\//).test(override) ? override : `ws://${globalThis.location?.hostname ?? 'localhost'}:${override}`

  const configured = process.env.NEXT_PUBLIC_BATTLE_SERVER_URL
  if (configured)
    return configured

  // `wss:` when the page is https, or the browser blocks the socket as mixed
  // content — a failure that shows up only once something is deployed.
  const secure = globalThis.location?.protocol === 'https:'
  return `${secure ? 'wss' : 'ws'}://${globalThis.location?.hostname ?? 'localhost'}:${DEFAULT_PORT}`
}

/**
 * The client half of the authoritative netcode.
 *
 * Owns the socket, the clock, the input pump and the pose buffers. One instance
 * lives for the life of a battle scene; the scene reads poses from it each
 * rendered frame.
 *
 * Remote ship positions never reach zustand — only the slim match state the
 * canvas HUD needs does, and that on a timer. A React commit per snapshot per
 * ship would cost more than the rendering.
 */
export class BattleTransport {
  readonly clock = new NetClock()

  private ws:      WebSocket | null = null
  private options: ConnectOptions | null = null
  private closed = false
  private attempts = 0

  private playerId: PlayerId | null = null
  private session:  string | null = null
  private team:     BattleTeam = 'red'

  /** Server-reported cadence, the basis for the interpolation delay. */
  private snapshotHz = 30

  private remoteList: NetRemote[] = []
  private remoteById = new Map<PlayerId, NetRemote>()

  /** Respawn counters last seen, to spot a teleport without trusting events. */
  private respawnSeen = new Map<PlayerId, number>()

  private newest:      StateMessage | null = null
  private newestLocal: SnapshotPlayer | null = null
  private events:      BattleEvent[] = []

  private seq = 0
  private pending: InputFrame[] = []
  private ackedSeq = 0
  private lastPing = 0
  private lastChrome = 0
  private correctionM = 0

  // --- lifecycle ------------------------------------------------------------

  connect (options: ConnectOptions): void {
    this.options = options
    this.closed  = false
    this.open()
  }

  private open (): void {
    const base = resolveServerUrl(this.options?.url)
    const url  = this.options?.match ? `${base}/battle?match=${encodeURIComponent(this.options.match)}` : `${base}/battle`

    useBattleStore.getState().setStatus('connecting')

    let ws: WebSocket
    try {
      ws = new WebSocket(url)
    }
    catch {
      this.scheduleReconnect()
      return
    }

    this.ws = ws

    ws.onopen = () => {
      this.attempts = 0
      this.send({
        type:     'join',
        protocol: PROTOCOL_VERSION,
        name:     this.options?.name ?? 'Pilot',
        shipId:   this.options?.shipId ?? 'icaras',
        loadout:  this.options?.loadout,
        // Present only on a reconnect, and what lets the server hand back the
        // same ship rather than respawning one.
        session:  this.session ?? undefined,
      })
    }

    ws.onmessage = ({ data }) => {
      try {
        this.route(jsonCodec.decode(data as string) as ServerMessage)
      }
      catch {
        // A frame the client cannot parse is the server's problem to fix, not
        // grounds to tear down a live match.
      }
    }

    ws.onerror = () => useBattleStore.getState().setStatus('error')

    ws.onclose = () => {
      if (this.ws !== ws)
        return
      this.ws = null
      if (!this.closed)
        this.scheduleReconnect()
    }
  }

  /**
   * Reconnect with backoff, keeping the session token.
   *
   * The server holds a dropped player's ship for a grace window, so a
   * reconnection inside it resumes the match in place instead of respawning.
   */
  private scheduleReconnect (): void {
    if (this.closed)
      return

    useBattleStore.getState().setStatus('connecting')

    const wait = BACKOFF[Math.min(this.attempts++, BACKOFF.length - 1)]

    setTimeout(() => {
      if (!this.closed)
        this.open()
    }, wait)
  }

  /** Leave deliberately: no reconnect, and the server frees the seat now. */
  close (): void {
    this.closed = true
    if (this.ws?.readyState === WebSocket.OPEN)
      this.send({ type: 'leave' })

    this.ws?.close()
    this.teardown()
  }

  private teardown (): void {
    this.ws         = null
    this.remoteList = []
    this.remoteById.clear()
    this.respawnSeen.clear()
    this.pending.length = 0
    this.events.length  = 0
    this.newest         = null
    this.newestLocal    = null
    this.clock.reset()
    useBattleStore.getState().resetSession()
  }

  private send (message: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(jsonCodec.encode(message as never))
  }

  // --- inbound --------------------------------------------------------------

  private route (message: ServerMessage): void {
    const store = useBattleStore.getState()

    switch (message.type) {
      case 'joined':
        this.playerId   = message.playerId
        this.session    = message.session
        this.team       = message.team
        this.snapshotHz = message.snapshotHz
        store.joined({
          playerId: message.playerId,
          team:     message.team,
          shipId:   message.shipId,
          name:     message.name,
        })
        if (message.status !== 'lobby' && message.status !== 'finished')
          store.setStatus(message.status)
        return
      case 'state':
        this.applySnapshot(message)
        return
      case 'events':
        // Buffered, not applied here. The scene needs the same events for
        // camera shake and impact bursts, and it owns the id→name map the kill
        // feed reads — so it drains them and does both.
        this.events.push(...message.list)
        if (this.events.length > MAX_BUFFERED_EVENTS)
          this.events.splice(0, this.events.length - MAX_BUFFERED_EVENTS)
        return
      case 'roster':
        store.setRoster(message.players.map(p => ({
          id:     p.id,
          name:   p.name,
          team:   p.team,
          isBot:  p.isBot,
          kills:  p.kills,
          deaths: p.deaths,
        })))
        return
      case 'pong':
        this.clock.accept(message.t0, message.serverTimeMs, performance.now() + this.epoch)
        return
      case 'queued':
        store.setStatus('queued')
        return
      case 'error':
        store.setError(message.message)
    }
  }

  /**
   * Local wall clock in the same units the server stamps with.
   *
   * `performance.now()` is monotonic but zeroed at page load, so it cannot be
   * compared to a `Date.now()` timestamp directly. The epoch bridges the two
   * once, and everything after runs on the monotonic clock — which is what
   * survives a system time change mid-match.
   */
  private readonly epoch = Date.now() - performance.now()

  localNowMs (): number {
    return performance.now() + this.epoch
  }

  private applySnapshot (message: StateMessage): void {
    this.newest   = message
    this.ackedSeq = message.lastProcessedInput

    // Everything acknowledged is history; what is left is what prediction
    // replays on top of the server's authoritative pose.
    while (this.pending.length && this.pending[0].seq <= this.ackedSeq)
      this.pending.shift()

    const live = new Set<PlayerId>()

    for (const player of message.snapshot.players) {
      live.add(player.id)

      if (player.id === this.playerId) {
        this.newestLocal = player
        continue
      }

      let remote = this.remoteById.get(player.id)
      if (!remote) {
        remote = {
          id:     player.id,
          team:   player.team,
          name:   player.name,
          interp: new NetBodyInterpolator(),
          state:  player,
        }
        this.remoteById.set(player.id, remote)
        this.remoteList.push(remote)
      }

      remote.state = player
      remote.team  = player.team
      remote.name  = player.name

      const pose = [ player.x, player.y, player.z, player.qx, player.qy, player.qz, player.qw ]

      // A changed respawn counter means the server moved this chassis rather
      // than flew it. Blending across that draws the ship streaking over the
      // arena, so the buffer restarts instead.
      const seenRespawn = this.respawnSeen.get(player.id)
      if (seenRespawn !== undefined && seenRespawn !== player.respawnIndex)
        remote.interp.teleport(message.serverTimeMs, pose)
      else
        remote.interp.commit(message.serverTimeMs, pose)

      this.respawnSeen.set(player.id, player.respawnIndex)
    }

    if (this.remoteList.some(r => !live.has(r.id))) {
      this.remoteList = this.remoteList.filter(r => live.has(r.id))
      for (const id of [ ...this.remoteById.keys() ])
        if (!live.has(id)) {
          this.remoteById.delete(id)
          this.respawnSeen.delete(id)
        }
    }

    this.commitChrome(message.snapshot)
  }

  private commitChrome (snapshot: BattleSnapshot): void {
    const at = this.localNowMs()
    if (at - this.lastChrome < CHROME_EVERY)
      return
    this.lastChrome = at

    useBattleStore.getState().setChrome({
      status:    snapshot.status,
      countdown: snapshot.countdown,
      timeLeft:  Math.round(snapshot.timeLeft),
      scores:    snapshot.scores,
      // Zone display names live in the arena, which the SCENE has and the
      // transport does not; it fills them in from its own copy.
      zones:     snapshot.zones.map(z => ({ ...z, name: z.id, short: z.id.slice(0, 2).toUpperCase() })),
      flags:     snapshot.flags.map(f => ({ team: f.team, state: f.state, carrierId: f.carrierId })),
    })
  }

  // --- outbound -------------------------------------------------------------

  /**
   * Queue one tick of input and return the frame, so the caller can apply the
   * same one to its prediction. Nothing is sent here — `flushInput` does that.
   */
  pushInput (input: BattleInput, clientTick: Tick): InputFrame {
    const frame: InputFrame = { ...input, seq: ++this.seq, clientTick }
    this.pending.push(frame)

    // The queue is bounded by what the server will accept in one bundle. Past
    // that the oldest frames are already lost causes.
    if (this.pending.length > MAX_INPUT_FRAMES)
      this.pending.splice(0, this.pending.length - MAX_INPUT_FRAMES)

    return frame
  }

  /**
   * Send every unacknowledged frame.
   *
   * The whole tail, every tick — not just what changed. The previous transport
   * sent a frame only when its `dirty` flag was set, so a held throttle went
   * out once and a single dropped packet left the server driving on stale
   * input until the player moved a stick again.
   */
  flushInput (interpTick: Tick): void {
    if (!this.pending.length)
      return

    this.send({
      type:            'input',
      frames:          this.pending,
      lastAckSnapshot: this.newest?.serverTick ?? 0,
      interpTick,
    })

    const at = this.localNowMs()
    if (at - this.lastPing >= PING_EVERY) {
      this.lastPing = at
      this.send({ type: 'ping', t0: at })
    }
  }

  /** Dev-only match manipulation; the server ignores it without `DEV_COMMANDS=1`. */
  sendDev (command: Record<string, unknown>): void {
    this.send({ type: 'dev', ...command })
  }

  // --- read-side ------------------------------------------------------------

  /**
   * The server time remote ships should be drawn at: far enough in the past
   * that the two snapshots bracketing it have both arrived.
   *
   * Two snapshot intervals, floored at 100 ms — the Source default, and the
   * margin that absorbs one or two lost packets rather than stalling on them.
   */
  renderTimeMs (): number {
    const delay = Math.max(100, 2 * 1000 / this.snapshotHz)
    return this.clock.now(this.localNowMs()) - delay
  }

  /**
   * Take every event received since the last call.
   *
   * Drained rather than dispatched on arrival, so the scene consumes them
   * inside its fixed tick — an event applied mid-render would shake the camera
   * a frame after the impact it belongs to.
   */
  drainEvents (): BattleEvent[] {
    if (!this.events.length)
      return EMPTY_EVENTS

    const out   = this.events
    this.events = []
    return out
  }

  remotes (): readonly NetRemote[] {
    return this.remoteList
  }

  /** Newest authoritative state for the local ship, or null before the first snapshot. */
  localState (): SnapshotPlayer | null {
    return this.newestLocal
  }

  latest (): BattleSnapshot | null {
    return this.newest?.snapshot ?? null
  }

  localId (): PlayerId | null {
    return this.playerId
  }

  localTeam (): BattleTeam {
    return this.team
  }

  /** Frames the server has not acknowledged: what reconciliation replays. */
  unacknowledged (): readonly InputFrame[] {
    return this.pending
  }

  serverTick (): Tick {
    return this.newest?.serverTick ?? 0
  }

  noteCorrection (metres: number): void {
    this.correctionM = metres
  }

  stats (): NetStats {
    const clock = this.clock.stats
    return {
      rttMs:         clock.rttMs,
      jitterMs:      clock.jitterMs,
      synced:        clock.synced,
      snapshotAgeMs: this.newest ? Math.max(0, Math.round(this.clock.now(this.localNowMs()) - this.newest.serverTimeMs)) : 0,
      correctionM:   this.correctionM,
      pending:       this.pending.length,
    }
  }
}
