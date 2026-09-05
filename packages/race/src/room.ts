/**
 * A race, as a Colyseus room.
 *
 * Structurally battle's twin, and the differences are the interesting part:
 *
 * - **No rewind buffer.** Race has no hitscan, so nothing is ever resolved
 *   against a past tick and there is nothing to lag-compensate.
 * - **The race starts itself.** A battle waits in a lobby; a race counts down
 *   as soon as anyone is on the grid, because a grid of one is still a hot lap.
 * - **A finished race disposes.** Standings are final, so the room records the
 *   result and lets go rather than idling.
 *
 * As in battle, the simulation does NOT run on Colyseus's interval directly:
 * that interval jitters, and `STEP` is simultaneously the client's clock step,
 * rapier's `world.timestep` and the `dt` `vehicleConfig` is tuned against.
 */

import { Room } from '@colyseus/core'
import { InputButton, STEP, TICK_HZ, acceptPacket, createSeat, decodeInputPacket, drainInput, encodeFor, snapshotHistory, ticksPerSnapshot } from '@crash-velocity/net'
import { createSimClock } from '@crash-velocity/physics/clock'
import { verifyTicket } from '@crash-velocity/data/auth/ticket'

import { RaceSim } from './sim'
import { RaceState, syncRaceState } from './state'
import { isTrackId, trackBundle } from './levels'
import { raceSnapshotOf } from './snapshot'

import type { Client } from '@colyseus/core'
import type { InputFrame, InputPacket, Seat } from '@crash-velocity/net'
import type { ShipId } from '@crash-velocity/physics/ships'
import type { TrackId } from './levels'
import type { RaceStateType } from './state'
import type { RaceInput } from './types'


export const MessageKind = {
  INPUT:    'i',
  SNAPSHOT: 's',
  EVENTS:   'e',
  PING:     'p',
  PONG:     'q',
} as const

/** Seconds a dropped racer's ship is held, so a reconnect comes back to it. */
const RECONNECT_GRACE_SEC = 15

/** Bots added so a lobby of one is still a race. */
const DEFAULT_GRID = 4

export type RaceRoomOptions = {
  trackId?: TrackId;
  bots?:    number;
}

export class RaceRoom extends Room<{ state: RaceStateType }> {
  maxClients = 12

  private sim!: RaceSim
  private readonly simClock = createSimClock({ step: STEP })
  private readonly seats = new Map<string, Seat>()
  private readonly netIndexOf = new Map<string, number>()
  private readonly history = snapshotHistory()

  private netSeq = 0
  private started = false

  static async onAuth (token: string): Promise<unknown> {
    // A guest is a legitimate visitor, not a failure: the ticket route mints one
    // for a signed-out browser too. Only a FORGED or expired ticket is refused.
    const ticket = token ? await verifyTicket(token) : null
    return ticket ?? { pilotId: null, name: 'Pilot' }
  }

  async onCreate (options: RaceRoomOptions = {}): Promise<void> {
    const trackId = isTrackId(options.trackId) ? options.trackId : 'flats'
    const { spec } = trackBundle(trackId)

    this.sim = await RaceSim.create(spec)
    this.setState(new RaceState({ trackId, laps: spec.laps }) as RaceStateType)
    this.setPatchRate(50)

    for (let i = 0; i < (options.bots ?? DEFAULT_GRID); i++)
      this.assignNetIndex(this.sim.addBot().id)

    this.onMessage(MessageKind.INPUT, (client, bytes: ArrayBuffer | Uint8Array) => {
      const seat = this.seats.get(client.sessionId)
      if (seat)
        acceptPacket(seat, decodeInput(bytes))
    })

    this.onMessage(MessageKind.PING, (client, t0: number) => {
      client.send(MessageKind.PONG, { t0, serverTimeMs: Date.now(), serverTick: this.sim.tick })
    })

    this.setSimulationInterval(deltaMs => this.drive(deltaMs), 1000 / TICK_HZ)
  }

  async onJoin (client: Client, options: { name?: string; shipId?: ShipId } = {}): Promise<void> {
    const auth  = client.auth as { pilotId: string | null; name: string } | undefined
    const racer = this.sim.addPlayer(auth?.name ?? options.name ?? 'Pilot', options.shipId ?? 'icaras')

    this.seats.set(client.sessionId, createSeat(racer.id, this.assignNetIndex(racer.id)))

    // The client needs its own net index before the first snapshot lands, so
    //  this rides the reliable channel on join.
    client.send('joined', {
      racerId:      racer.id,
      netIndex:     this.netIndexOf.get(racer.id),
      trackId:      this.sim.track.id,
      tickHz:       TICK_HZ,
      serverTick:   this.sim.tick,
      serverTimeMs: Date.now(),
    })

    // A grid of one is still a hot lap: the lights go out on the first arrival
    //  rather than waiting for a quorum that a single-player track never gets.
    if (!this.started) {
      this.started = true
      this.sim.start()
    }
  }

  async onLeave (client: Client, code?: number): Promise<void> {
    const seat = this.seats.get(client.sessionId)
    if (!seat)
      return

    // Hold the ship rather than deleting it: someone who drops mid-lap should
    // come back to their hull and their lap time.
    if (code !== 4000) {
      try {
        await this.allowReconnection(client, RECONNECT_GRACE_SEC)
        return
      }
      catch {
        // grace expired — release the seat
      }
    }

    this.sim.removeRacer(seat.playerId)
    this.netIndexOf.delete(seat.playerId)
    this.seats.delete(client.sessionId)
  }

  onDispose (): void {
    this.sim?.dispose()
  }

  private drive (deltaMs: number): void {
    for (const step of this.simClock.advance(deltaMs / 1000))
      this.stepOnce(step)
  }

  private stepOnce (dt: number): void {
    for (const seat of this.seats.values())
      for (const frame of drainInput(seat))
        this.sim.setInput(seat.playerId, toRaceInput(frame))

    this.sim.step(dt)

    const events = this.sim.drainEvents()
    if (events.length > 0)
      this.broadcast(MessageKind.EVENTS, events)

    if (this.sim.tick % ticksPerSnapshot() === 0)
      this.broadcastSnapshot()
  }

  private broadcastSnapshot (): void {
    const snapshot = raceSnapshotOf(this.sim, id => this.netIndexOf.get(id) ?? 0)

    this.history.push(snapshot)
    syncRaceState(this.state, this.sim.snapshot(), id => this.netIndexOf.get(id) ?? 0)

    // One encode per distinct baseline, not per client.
    const cache = new Map<number, Uint8Array>()

    for (const client of this.clients) {
      const seat = this.seats.get(client.sessionId)
      if (seat)
        client.sendBytes(MessageKind.SNAPSHOT, encodeFor(snapshot, seat, this.history, cache))
    }
  }

  private assignNetIndex (racerId: string): number {
    const index = ++this.netSeq & 0xffff
    this.netIndexOf.set(racerId, index)
    return index
  }
}

function toRaceInput (frame: InputFrame): RaceInput {
  return {
    steer:    frame.steer,
    strafe:   frame.strafe,
    aimPitch: frame.pitch,
    throttle: frame.throttle > 0.5,
    brake:    frame.brake > 0.5,
    boost:    (frame.buttons & InputButton.BOOST) !== 0,
    reverse:  (frame.buttons & InputButton.REVERSE) !== 0,
    resetSeq: frame.resetSeq,
  }
}

/** A malformed packet is refused, not fatal — anything can arrive on a public
 *  socket, and an empty packet is the same thing as a lost one. */
function decodeInput (bytes: ArrayBuffer | Uint8Array): InputPacket {
  try {
    return decodeInputPacket(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes)
  }
  catch {
    return { frames: [], lastAckSnapshot: 0, interpTick: 0 }
  }
}
