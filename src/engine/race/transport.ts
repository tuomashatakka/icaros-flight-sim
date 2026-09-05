/**
 * Race's client transport.
 *
 * Battle's twin, and deliberately so: the netcode underneath is `RoomLink`,
 * shared by both, and all that differs is which schema hangs off the room and
 * how the two channels are joined back together.
 *
 * That symmetry is the point of the whole refactor. Race used to have no wire
 * at all — its rules lived in a zustand store driven by rapier sensor
 * collisions, which could only ever run in one browser tab for one ship.
 */

import { RaceState } from '@crash-velocity/race/state'
import { fromRaceInput } from '@crash-velocity/race/input'

import { RoomLink } from '../net/room-link'

import type { NetBodyInterpolator, ShipState } from '@crash-velocity/net'
import type { RaceStateType } from '@crash-velocity/race/state'
import type { RaceEvent, RaceInput, RaceStatus } from '@crash-velocity/race'
import type { TrackId } from '@crash-velocity/race'
import type { ShipId } from '@crash-velocity/physics/ships'
import type { NetStats } from '../net/room-link'


export type { NetStats }

/** Radians of trim the ±1 wire range maps onto. Matches the sims. */
const AIM_NORMALISER = Math.PI / 4

/** One racer, both channels joined. */
export type ViewRacer = {
  id:     string;
  name:   string;
  shipId: ShipId;
  isBot:  boolean;
  x:      number;
  y:      number;
  z:      number;
  qx:     number;
  qy:     number;
  qz:     number;
  qw:     number;

  // Race carries the boost meter in the wire record's health slot — it has no
  //  damage model, and forking the codec for one scalar was not worth it.
  boost:    number;
  grounded: boolean;

  lap:            number;
  position:       number;
  nextCheckpoint: number;
  elapsed:        number;
  lapElapsed:     number;
  bestLap:        number | null;
  finished:       boolean;
  aimAngle:       number;
  respawnIndex:   number;
}

export type RaceView = {
  tick:      number;
  status:    RaceStatus;
  countdown: number;
  trackId:   string;
  laps:      number;
  racers:    ViewRacer[];
}

export type NetRacer = {
  id:     string;
  name:   string;
  interp: NetBodyInterpolator;
  state:  ViewRacer;
}

export type RaceConnectOptions = {
  name:    string;
  shipId:  ShipId;
  trackId: TrackId;
  server?: string;
}

export class RaceTransport {
  private readonly link = new RoomLink<RaceStateType, RaceEvent>()
  private view:        RaceView | null = null
  private viewKey = ''
  private remoteView:  RaceView | null = null
  private remoteCache: NetRacer[] = []

  get clock () {
    return this.link.clock
  }

  connect (options: RaceConnectOptions): void {
    void this.link.connect({
      room:    'race',
      state:   RaceState as never,
      name:    options.name,
      server:  options.server,
      options: { trackId: options.trackId, shipId: options.shipId },
    })
  }

  close (): void {
    this.link.close()
  }

  pushInput (input: RaceInput, clientTick: number) {
    return this.link.pushInput(fromRaceInput(input, clientTick))
  }

  flushInput (interpTick: number): void {
    this.link.flush(interpTick)
  }

  unacknowledged () {
    return this.link.unacknowledged()
  }

  renderTimeMs (): number {
    return this.link.renderTimeMs()
  }

  serverTick (): number {
    return this.link.serverTick()
  }

  drainEvents (): RaceEvent[] {
    return this.link.drainEvents()
  }

  noteCorrection (metres: number): void {
    this.link.noteCorrection(metres)
  }

  stats (): NetStats {
    return this.link.stats()
  }

  localId (): string | null {
    const index = this.link.netIndex
    if (index < 0)
      return null

    for (const [ id, entry ] of this.link.state?.racers ?? [])
      if (entry.netIndex === index)
        return id
    return null
  }

  localState (): ViewRacer | null {
    const id = this.localId()
    return id ? this.latest()?.racers.find(r => r.id === id) ?? null : null
  }

  remotes (): readonly NetRacer[] {
    const view = this.latest()
    if (!view)
      return []
    if (view === this.remoteView)
      return this.remoteCache

    const byIndex = new Map<number, ViewRacer>()
    for (const racer of view.racers) {
      const index = this.link.state?.racers.get(racer.id)?.netIndex
      if (index !== undefined)
        byIndex.set(index, racer)
    }

    const out: NetRacer[] = []
    for (const remote of this.link.remotes()) {
      const racer = byIndex.get(remote.netIndex)
      if (racer)
        out.push({ id: racer.id, name: racer.name, interp: remote.interp, state: racer })
    }
    this.remoteView  = view
    this.remoteCache = out
    return out
  }

  // Join the two channels. The two server ticks form the cache key because
  // Schema and packed snapshots change at different rates.
  latest (): RaceView | null {
    const state = this.link.state
    if (!state)
      return null

    const snapshotTick = this.link.latest()?.serverTick ?? 0
    const key          = `${state.serverTick}:${snapshotTick}`
    if (this.view && key === this.viewKey)
      return this.view

    const poses = new Map<number, ShipState>()
    for (const ship of this.link.latest()?.ships ?? [])
      poses.set(ship.id, ship)

    const racers: ViewRacer[] = []
    for (const [ id, entry ] of state.racers) {
      const pose = poses.get(entry.netIndex)
      racers.push({
        id,
        name:     entry.name,
        shipId:   entry.shipId as ShipId,
        isBot:    entry.isBot,
        x:        pose?.x ?? 0,
        y:        pose?.y ?? 0,
        z:        pose?.z ?? 0,
        qx:       pose?.qx ?? 0,
        qy:       pose?.qy ?? 0,
        qz:       pose?.qz ?? 0,
        qw:       pose?.qw ?? 1,
        boost:    (pose?.health ?? 255) / 255,
        grounded: ((pose?.flags ?? 0) & 8) !== 0,

        lap:            entry.lap,
        position:       entry.position,
        nextCheckpoint: entry.nextCheckpoint,
        elapsed:        entry.elapsed,
        lapElapsed:     entry.lapElapsed,
        // −1 is the wire's "no best lap yet"; the wire has no nullable number.
        bestLap:        entry.bestLap < 0 ? null : entry.bestLap,
        finished:       entry.finished,
        aimAngle:       (pose?.aim ?? 0) * AIM_NORMALISER,
        respawnIndex:   pose?.respawnIndex ?? 0,
      })
    }

    this.viewKey = key
    this.view    = {
      tick:      state.serverTick,
      status:    state.status as RaceStatus,
      countdown: state.countdown,
      trackId:   state.trackId,
      laps:      state.laps,
      racers,
    }
    return this.view
  }
}
