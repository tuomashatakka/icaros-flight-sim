/**
 * One match: an authoritative `BattleSim` and the clients watching it.
 *
 * The sim needed no changes to live here — `step(dt)`'s own comment already
 * said "Called by the server every tick", and `setInput` already refuses to
 * overwrite a bot's controls. What the room adds is everything around it: input
 * buffering, acknowledgement, broadcast cadence and roster churn.
 *
 * Transport is injected as a `send` callback per client rather than a socket, so
 * a room can be ticked in a test with no network at all.
 */

import { BattleSim } from 'Δengine/battle/sim'
import { apexArena } from 'Δengine/battle/arena'
import { toBattleInput } from 'Δengine/battle/protocol'
import { DEFAULT_BACKFILL, rebalanceBots, teamForJoin } from './bots'
import { RewindBuffer } from './rewind'
import type { BackfillConfig } from './bots'
import type { BattleTeam } from 'Δengine/battle/arena'
import type { Loadout } from 'Δengine/battle/weapons'
import type { ShipId } from 'Δlib/ship/registry'
import type {
  InputFrame,
  InputPacket,
  PlayerId,
  RosterEntry,
  ServerMessage,
  Tick,
} from 'Δengine/battle/protocol'


/**
 * Input frames the room will hold for one client before it starts draining two
 * per tick.
 *
 * A queue is latency: every frame sitting in it is a frame the player has
 * already flown but the world has not seen. A queue of zero is worse — the
 * sim repeats stale input on any jitter. Two frames absorbs ordinary jitter at
 * 60 Hz without adding perceptible lag, which is the same tradeoff Overwatch
 * makes when it dilates a client's clock to keep this buffer minimal.
 */
const TARGET_INPUT_BUFFER = 2

/** Hard cap, so a client that floods cannot make the room replay forever. */
const MAX_INPUT_BUFFER = 16

export type RoomClient = {
  playerId: PlayerId;
  name:     string;

  /** Resume token, so a dropped socket can reclaim this ship. */
  session: string;

  connected: boolean;

  /** Wall-clock ms of the disconnect, for the grace window. `null` while live. */
  disconnectedAt: number | null;

  /** Highest input seq folded into the sim. Echoed so the client can reconcile. */
  lastProcessedInput: number;

  /** Server tick this client was rendering remotes at, for lag compensation. */
  interpTick: Tick;

  send (message: ServerMessage): void;
}

export type RoomOptions = {
  id:         string;
  tickHz:     number;
  snapshotHz: number;
  maxPlayers: number;
  backfill?:  BackfillConfig;
  arenaId?:   string;
  now?:       () => number;
}

export type JoinResult =
  | { ok: true; client: RoomClient } |
  { ok: false; reason: 'room-full' }

export class BattleRoom {
  readonly id:         string
  readonly sim:        BattleSim
  readonly arenaId:    string
  readonly tickHz:     number
  readonly snapshotHz: number

  private readonly clients = new Map<PlayerId, RoomClient>()
  private readonly queues = new Map<PlayerId, InputFrame[]>()
  private readonly lastFrame = new Map<PlayerId, InputFrame>()
  private readonly rewind:       RewindBuffer
  private readonly ticksPerSnap: number
  private readonly maxPlayers:   number
  private readonly backfill:     BackfillConfig
  private readonly now:          () => number

  private tickNo = 0
  private idSeq = 0
  private startedAt = 0

  private constructor (sim: BattleSim, options: RoomOptions) {
    this.sim          = sim
    this.id           = options.id
    this.arenaId      = options.arenaId ?? 'apex'
    this.tickHz       = options.tickHz
    this.snapshotHz   = options.snapshotHz
    this.maxPlayers   = options.maxPlayers
    this.backfill     = options.backfill ?? DEFAULT_BACKFILL
    this.now          = options.now ?? (() => Date.now())
    this.ticksPerSnap = Math.max(1, Math.round(options.tickHz / options.snapshotHz))
    this.rewind       = new RewindBuffer(options.tickHz)
    this.startedAt    = this.now()

    // Shots resolve against what the shooter saw. Installed here rather than
    // inside the sim because it is a SERVER concern: a local run has no round
    // trip to compensate for and must stay on the un-rewound path.
    sim.lagCompensation = shooter => {
      const client = this.clients.get(shooter.id)
      if (!client)
        // A bot. It sees the present, so there is nothing to rewind.
        return null

      const tick = this.rewind.resolveTick(client.interpTick, this.tickNo)
      return tick === this.tickNo ? null : this.rewind.poseSourceAt(tick)
    }
  }

  static async create (options: RoomOptions): Promise<BattleRoom> {
    const sim  = await BattleSim.create(apexArena())
    const room = new BattleRoom(sim, options)

    rebalanceBots(sim, room.backfill)

    // Start immediately with no countdown. A room exists because a match was
    // asked for, and holding arrivals in a lobby phase the server cannot end on
    // its own would just be a way to never start.
    sim.start(0)
    return room
  }

  // --- roster ---------------------------------------------------------------

  get humanCount (): number {
    return this.sim.players.filter(p => !p.isBot).length
  }

  get empty (): boolean {
    return this.clients.size === 0
  }

  /** Server clock, the base every client's offset estimate is built on. */
  serverTimeMs (): number {
    return this.now()
  }

  get tick (): Tick {
    return this.tickNo
  }

  get uptimeMs (): number {
    return this.now() - this.startedAt
  }

  /** Ticks of hitbox history held, for `/health`. */
  get rewindDepth (): number {
    return this.rewind.depth
  }

  join (
    name: string,
    shipId: ShipId,
    send: (message: ServerMessage) => void,
    loadout?: Loadout
  ): JoinResult {
    if (this.humanCount >= this.maxPlayers)
      return { ok: false, reason: 'room-full' }

    const team   = teamForJoin(this.sim)
    const player = this.sim.addPlayer(name, team, shipId)
    if (loadout)
      this.sim.setLoadout(player.id, loadout)

    const client: RoomClient = {
      playerId:           player.id,
      name,
      session:            `s${this.id}:${this.idSeq++}:${crypto.randomUUID()}`,
      connected:          true,
      disconnectedAt:     null,
      lastProcessedInput: 0,
      interpTick:         0,
      send,
    }

    this.clients.set(player.id, client)
    this.queues.set(player.id, [])

    // Humans displace bots, so the deck size stays constant as a match fills.
    rebalanceBots(this.sim, this.backfill)
    this.broadcastRoster()

    return { ok: true, client }
  }

  /**
   * Reclaim a ship after a socket drop.
   *
   * The ship is left flying during the grace window rather than removed, which
   * is why this can hand back the same `playerId` and the player resumes where
   * they were instead of respawning.
   */
  resume (session: string, send: (message: ServerMessage) => void): RoomClient | null {
    for (const client of this.clients.values())
      if (client.session === session && !client.connected) {
        client.connected      = true
        client.disconnectedAt = null
        client.send           = send
        this.broadcastRoster()
        return client
      }
    return null
  }

  markDisconnected (playerId: PlayerId): void {
    const client = this.clients.get(playerId)
    if (!client)
      return

    client.connected      = false
    client.disconnectedAt = this.now()
    client.send           = () => {}

    // Neutral controls, or the ship flies on holding whatever was last pressed
    // until the grace window expires.
    this.queues.set(playerId, [])
    this.lastFrame.delete(playerId)
    this.sim.setInput(playerId, { ...NEUTRAL_CONTROLS, resetSeq: client.lastProcessedInput })
  }

  leave (playerId: PlayerId): void {
    if (!this.clients.delete(playerId))
      return

    this.queues.delete(playerId)
    this.lastFrame.delete(playerId)
    this.sim.removePlayer(playerId)
    rebalanceBots(this.sim, this.backfill)
    this.broadcastRoster()
  }

  /** Evict anyone whose grace window has run out. Called from the room sweep. */
  reapDisconnected (graceMs: number): PlayerId[] {
    const at                  = this.now()
    const expired: PlayerId[] = []

    for (const client of this.clients.values())
      if (!client.connected && client.disconnectedAt !== null && at - client.disconnectedAt > graceMs)
        expired.push(client.playerId)

    for (const id of expired)
      this.leave(id)

    return expired
  }

  clientOf (playerId: PlayerId): RoomClient | undefined {
    return this.clients.get(playerId)
  }

  // --- input ----------------------------------------------------------------

  /**
   * Buffer one input bundle.
   *
   * Bundles re-send the whole unacknowledged tail, so the same frame arrives
   * many times over; only frames past what the sim has already consumed are
   * kept, which is what makes packet loss self-healing rather than duplicated.
   */
  acceptInput (playerId: PlayerId, packet: InputPacket): void {
    const client = this.clients.get(playerId)
    const queue  = this.queues.get(playerId)
    if (!client || !queue)
      return

    client.interpTick = packet.interpTick

    let highest = queue.length ? queue[queue.length - 1].seq : client.lastProcessedInput
    for (const frame of packet.frames)
      if (frame.seq > highest) {
        queue.push(frame)
        highest = frame.seq
      }

    // Drop the oldest on overflow, never the newest: a flooding or badly lagged
    // client should end up playing the present, not a backlog.
    if (queue.length > MAX_INPUT_BUFFER)
      queue.splice(0, queue.length - MAX_INPUT_BUFFER)
  }

  /**
   * Hand the sim one frame of input per player for this tick.
   *
   * Draining two frames when the queue is long keeps the buffer near
   * `TARGET_INPUT_BUFFER` instead of letting a burst turn into permanent added
   * latency. An empty queue repeats the last frame, which is the right guess:
   * controls are held far more often than they are released, and it means a
   * lost packet reads as "still holding" rather than "let go".
   */
  private applyInputs (): void {
    for (const client of this.clients.values()) {
      const queue = this.queues.get(client.playerId)
      if (!queue)
        continue

      const drain = queue.length > TARGET_INPUT_BUFFER ? 2 : 1
      let frame: InputFrame | undefined

      for (let i = 0; i < drain && queue.length; i++)
        frame = queue.shift()

      if (frame)
        this.lastFrame.set(client.playerId, frame)
      else
        frame = this.lastFrame.get(client.playerId)

      if (!frame)
        continue

      client.lastProcessedInput = frame.seq
      this.sim.setInput(client.playerId, toBattleInput(frame))
    }
  }

  // --- tick -----------------------------------------------------------------

  step (dt: number): void {
    this.applyInputs()
    this.sim.step(dt)
    this.tickNo++

    // Recorded after the step and after the tick advances, so a frame's number
    // matches the poses a snapshot taken at that tick would carry — which is
    // what a client's `interpTick` refers to.
    this.rewind.record(this.tickNo, this.sim.players)

    const events = this.sim.drainEvents()
    if (events.length)
      this.broadcast({ type: 'events', list: events })

    if (this.tickNo % this.ticksPerSnap === 0)
      this.broadcastSnapshot()
  }

  private broadcastSnapshot (): void {
    const snapshot = this.sim.snapshot()
    const at       = this.now()

    // Built once and re-stamped per client: only `lastProcessedInput` differs,
    // and re-serialising the whole world per player would dominate the tick.
    for (const client of this.clients.values()) {
      if (!client.connected)
        continue

      client.send({
        type:               'state',
        serverTick:         this.tickNo,
        serverTimeMs:       at,
        baselineTick:       this.tickNo,
        lastProcessedInput: client.lastProcessedInput,
        snapshot,
      })
    }
  }

  roster (): RosterEntry[] {
    return this.sim.players.map(p => ({
      id:     p.id,
      name:   p.name,
      team:   p.team as BattleTeam,
      isBot:  p.isBot,
      shipId: p.shipId,
      kills:  p.kills,
      deaths: p.deaths,
    }))
  }

  broadcastRoster (): void {
    this.broadcast({ type: 'roster', players: this.roster() })
  }

  broadcast (message: ServerMessage): void {
    for (const client of this.clients.values())
      if (client.connected)
        client.send(message)
  }

  dispose (): void {
    this.clients.clear()
    this.queues.clear()
    this.lastFrame.clear()
    this.sim.dispose()
  }
}

/**
 * Hands-off controls. Local rather than imported from the sim's `NEUTRAL_INPUT`
 * because `resetSeq` has to carry the client's own counter — reusing the shared
 * constant's zero would read as a respawn request on the next tick.
 */
const NEUTRAL_CONTROLS = {
  steer:         0,
  throttle:      false,
  brake:         false,
  boost:         false,
  fire:          false,
  fireSecondary: false,
  reverse:       false,
  strafe:        0,
  aimPitch:      0,
  resetSeq:      0,
}
