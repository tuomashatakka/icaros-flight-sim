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

import { RaceState } from 'Λstate'
import { fromRaceInput } from 'Λinput'

import { RoomLink } from '../net/room-link'

import type { NetBodyInterpolator, ShipState } from 'Ξ'
import type { RaceStateType } from 'Λstate'
import type { RaceEvent, RaceInput, RaceStatus } from 'Λ'
import type { TrackId } from 'Λ'
import type { ShipId } from 'Φships'
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

  /** Hull integrity, 0..1, off the schema channel. */
  hull: number;

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
  racers:    readonly ViewRacer[];
}

export type RaceFrame = RaceView & {
  readonly racersById:        ReadonlyMap<string, ViewRacer>;
  readonly racersByNetIndex:  ReadonlyMap<number, ViewRacer>;
  readonly remotes:           readonly NetRacer[];
  readonly remotesById:       ReadonlyMap<string, NetRacer>;
  readonly remotesByNetIndex: ReadonlyMap<number, NetRacer>;
  readonly local:             ViewRacer | null;
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
  private frameView:     RaceFrame | null = null
  private frameSnapshot: ShipState[] | null = null
  private frameStateVersion = -1

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
    return this.frame()?.local ?? null
  }

  remotes (): readonly NetRacer[] {
    return this.frame()?.remotes ?? []
  }

  // Join the two channels once per binary snapshot or Schema patch. Calls in
  // between return the same read-only frame and indexes.
  frame (): RaceFrame | null {
    const state = this.link.state
    if (!state)
      return null

    const snapshot = this.link.latest()
    if (this.frameView && this.frameSnapshot === snapshot?.ships && this.frameStateVersion === this.link.stateVersion)
      return this.frameView

    const poses = new Map<number, ShipState>()
    for (const ship of snapshot?.ships ?? [])
      poses.set(ship.id, ship)

    const racers: ViewRacer[] = []
    const racersById          = new Map<string, ViewRacer>()
    const racersByNetIndex    = new Map<number, ViewRacer>()
    for (const [ id, entry ] of state.racers) {
      const pose             = poses.get(entry.netIndex)
      const racer: ViewRacer = {
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
        hull:     entry.health / 100,

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
      }
      racers.push(racer)
      racersById.set(id, racer)
      racersByNetIndex.set(entry.netIndex, racer)
    }

    const remotes: NetRacer[] = []
    const remotesById         = new Map<string, NetRacer>()
    const remotesByNetIndex   = new Map<number, NetRacer>()
    for (const remote of this.link.remotes()) {
      const racer = racersByNetIndex.get(remote.netIndex)
      if (!racer)
        continue

      const joined = { id: racer.id, name: racer.name, interp: remote.interp, state: racer }
      remotes.push(joined)
      remotesById.set(joined.id, joined)
      remotesByNetIndex.set(remote.netIndex, joined)
    }

    this.frameSnapshot     = snapshot?.ships ?? null
    this.frameStateVersion = this.link.stateVersion
    this.frameView         = {
      tick:      state.serverTick,
      status:    state.status as RaceStatus,
      countdown: state.countdown,
      trackId:   state.trackId,
      laps:      state.laps,
      racers,
      racersById,
      racersByNetIndex,
      remotes,
      remotesById,
      remotesByNetIndex,
      local:     racersByNetIndex.get(this.link.netIndex) ?? null,
    }
    return this.frameView
  }

  latest (): RaceView | null {
    return this.frame()
  }
}
