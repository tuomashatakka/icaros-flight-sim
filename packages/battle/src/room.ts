/**
 * A battle match, as a Colyseus room.
 *
 * Colyseus owns the things it is good at — matchmaking, seat reservation,
 * reconnection, the patch cadence, room lifecycle — and this class owns the
 * two things it is not: a fixed-step deterministic simulation, and a
 * bit-packed snapshot channel.
 *
 * The simulation does NOT run on Colyseus's interval directly. That interval is
 * a `setInterval` and therefore jitters, and `STEP` is simultaneously the
 * client's clock step, rapier's `world.timestep` and the `dt` `vehicleConfig`
 * is tuned against. So the interval merely *drives* a fixed-step accumulator,
 * exactly as the previous hand-rolled loop did — a variable `dt` reaching
 * `stepHovercraft` would retune every ship and desync every prediction.
 */

import { Room } from '@colyseus/core'
import { STEP, TICK_HZ, acceptPacket, createSeat, decodeInputPacket, drainInput, encodeFor, snapshotHistory, ticksPerSnapshot } from '@crash-velocity/net'
import { createSimClock } from '@crash-velocity/physics/clock'
import { verifyTicket } from '@crash-velocity/data/auth/ticket'

import { BattleSim } from './sim'
import { BattleState, syncBattleState } from './state'
import { DEFAULT_BACKFILL, rebalanceBots, teamForJoin } from './bots'
import { apexArena } from './arena'
import { createBattleRewind } from './rewind'
import { battleSnapshotOf } from './snapshot'

import type { Client } from '@colyseus/core'
import { InputButton } from '@crash-velocity/net'

import type { InputFrame, InputPacket, Seat } from '@crash-velocity/net'
import type { BattleStateType } from './state'
import type { BattlePlayer } from './sim'
import type { ShipId } from '@crash-velocity/physics/ships'
import type { Loadout } from './weapons'


export const MessageKind = {
  INPUT:    'i',
  SNAPSHOT: 's',
  EVENTS:   'e',
  PING:     'p',
  PONG:     'q',
} as const

/** Seconds a dropped pilot's ship is held, so a reconnect comes back to it. */
const RECONNECT_GRACE_SEC = 15

export type BattleRoomOptions = {
  arenaId?: string;
  botFill?: boolean;
}

export class BattleRoom extends Room<{ state: BattleStateType }> {
  maxClients = 16

  private sim!: BattleSim
  private rewind = createBattleRewind(TICK_HZ)
  // NOT `clock`: Room already has one (a ClockTimer for delayed callbacks).
  private readonly simClock = createSimClock({ step: STEP })
  private readonly seats = new Map<string, Seat>()
  private readonly netIndexOf = new Map<string, number>()
  private readonly history = snapshotHistory()

  private tickNo = 0
  private netSeq = 0
  private startedAt = Date.now()
  private botFill = true

  static async onAuth (token: string): Promise<unknown> {
    // A guest is a legitimate visitor, not a failure: the ticket route mints one
    // for a signed-out browser too. Only a FORGED or expired ticket is refused.
    const ticket = token ? await verifyTicket(token) : null
    return ticket ?? { pilotId: null, name: 'Pilot' }
  }

  async onCreate (options: BattleRoomOptions = {}): Promise<void> {
    this.botFill = options.botFill ?? true
    this.sim     = await BattleSim.create(apexArena())

    this.setState(new BattleState({ arenaId: this.sim.arena.id }) as BattleStateType)

    // 20 Hz for the schema channel — Colyseus's default, and the document's
    // floor for a state stream. The bit-packed ship snapshot goes out at 30.
    this.setPatchRate(50)

    // Only the fire pass is lag-compensated. The physics step must never see a
    // rewound pose, or the world disagrees with where it just put things.
    this.sim.lagCompensation = shooter => {
      const seat = this.seats.get(shooter.id)
      if (!seat)
        return null // a bot sees the present

      return this.rewind.poseSourceAt(this.rewind.resolveTick(seat.interpTick, this.tickNo))
    }

    this.onMessage(MessageKind.INPUT, (client, bytes: ArrayBuffer | Uint8Array) => this.acceptInput(client, bytes))
    this.onMessage(MessageKind.PING, (client, t0: number) => {
      client.send(MessageKind.PONG, { t0, serverTimeMs: Date.now(), serverTick: this.tickNo })
    })

    this.setSimulationInterval(deltaMs => this.drive(deltaMs), 1000 / TICK_HZ)
  }

  async onJoin (client: Client, options: { name?: string; shipId?: ShipId; loadout?: Loadout } = {}): Promise<void> {
    const auth = client.auth as { pilotId: string | null; name: string } | undefined
    const name = auth?.name ?? options.name ?? 'Pilot'

    const player = this.sim.addPlayer(name, teamForJoin(this.sim), options.shipId ?? 'icaras', options.loadout)

    this.seats.set(client.sessionId, createSeat(player.id, this.assignNetIndex(player.id)))

    // The client needs to know which decoded transform is its own before the
    //  first snapshot lands, so this rides the reliable channel on join.
    client.send('joined', {
      playerId:   player.id,
      netIndex:   this.netIndexOf.get(player.id),
      team:       player.team,
      tickHz:     TICK_HZ,
      serverTick: this.tickNo,
      serverTimeMs: Date.now(),
      arenaId:    this.sim.arena.id,
    })

    if (this.botFill)
      rebalanceBots(this.sim, { ...DEFAULT_BACKFILL, minPlayers: Math.max(2, this.sim.players.length) })
  }

  async onLeave (client: Client, code?: number): Promise<void> {
    const seat = this.seats.get(client.sessionId)
    if (!seat)
      return

    // Hold the ship rather than deleting it: someone who drops mid-fight should
    // come back to their hull, not to a respawn. `consented` (4000) means they
    // pressed leave, and there is nothing to hold.
    const consented = code === 4000
    if (!consented) {
      try {
        await this.allowReconnection(client, RECONNECT_GRACE_SEC)
        return
      }
      catch {
        // grace expired — fall through and release the seat
      }
    }

    this.sim.removePlayer(seat.playerId)
    this.netIndexOf.delete(seat.playerId)
    this.seats.delete(client.sessionId)

    if (this.botFill)
      rebalanceBots(this.sim, DEFAULT_BACKFILL)
  }

  onDispose (): void {
    this.sim?.dispose()
  }

  // --- the loop ---------------------------------------------------------------

  private drive (deltaMs: number): void {
    for (const step of this.simClock.advance(deltaMs / 1000))
      this.stepOnce(step)
  }

  private stepOnce (dt: number): void {
    this.applyInputs()
    this.sim.step(dt)
    this.tickNo++

    this.rewind.record(this.tickNo, this.sim.players)

    const events = this.sim.drainEvents()
    if (events.length > 0)
      this.broadcast(MessageKind.EVENTS, events)

    if (this.tickNo % ticksPerSnapshot() === 0)
      this.broadcastSnapshot()
  }

  private applyInputs (): void {
    for (const seat of this.seats.values())
      for (const frame of drainInput(seat))
        this.sim.setInput(seat.playerId, toBattleInput(frame))
  }

  private acceptInput (client: Client, bytes: ArrayBuffer | Uint8Array): void {
    const seat = this.seats.get(client.sessionId)
    if (seat)
      acceptPacket(seat, decodeInput(bytes))
  }

  private broadcastSnapshot (): void {
    const snapshot = battleSnapshotOf(this.sim, this.tickNo, id => this.netIndexOf.get(id) ?? 0)

    this.history.push(snapshot)
    syncBattleState(this.state, this.sim.snapshot(), id => this.netIndexOf.get(id) ?? 0)

    // One encode per distinct baseline, not per client: sixteen clients that
    // have all acknowledged the same snapshot share one buffer.
    const cache = new Map<number, Uint8Array>()

    for (const client of this.clients) {
      const seat = this.seats.get(client.sessionId)
      if (!seat)
        continue

      const bytes = encodeFor(snapshot, seat, this.history, cache)
      client.sendBytes(MessageKind.SNAPSHOT, bytes)
    }
  }

  private assignNetIndex (playerId: string): number {
    const index = ++this.netSeq & 0xffff
    this.netIndexOf.set(playerId, index)
    return index
  }
}

function toBattleInput (frame: InputFrame) {
  return {
    steer:         frame.steer,
    strafe:        frame.strafe,
    aimPitch:      frame.pitch,
    throttle:      frame.throttle > 0.5,
    brake:         frame.brake > 0.5,
    boost:         (frame.buttons & InputButton.BOOST) !== 0,
    fire:          (frame.buttons & InputButton.FIRE) !== 0,
    fireSecondary: (frame.buttons & InputButton.SECONDARY) !== 0,
    reverse:       (frame.buttons & InputButton.REVERSE) !== 0,
    resetSeq:      frame.resetSeq,
  }
}

/**
 * A malformed packet is refused, not fatal.
 *
 * Anything at all can arrive on a public socket, and a decode that throws would
 * take the whole room's message pump with it. An empty packet is the same thing
 * as a lost one, which the input queue already knows how to survive.
 */
function decodeInput (bytes: ArrayBuffer | Uint8Array): InputPacket {
  try {
    return decodeInputPacket(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes)
  }
  catch {
    return { frames: [], lastAckSnapshot: 0, interpTick: 0 }
  }
}
