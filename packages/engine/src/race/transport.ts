/**
 * Race's client transport.
 *
 * Battle's twin, and deliberately so: the netcode underneath is `RoomLink`,
 * shared by both, and all that differs is which schema hangs off the room and
 * how the two channels are joined back together. `ModeTransportBase` is the
 * shared half of that join (see its own doc); this file is what is left once
 * the ten `RoomLink` delegates and the memoised merge are factored out — the
 * racer roster, the lap/gate fields, and the wire connect options.
 *
 * That symmetry is the point of the whole refactor. Race used to have no wire
 * at all — its rules lived in a zustand store driven by rapier sensor
 * collisions, which could only ever run in one browser tab for one ship.
 */

import { RaceState } from 'Λstate'
import { fromRaceInput } from 'Λinput'

import { ModeTransportBase } from '../net/mode-transport'

import type { NetBodyInterpolator, Snapshot } from 'Ξ'
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
  // Velocity, straight off the wire. The codec has always carried it; this
  //  view used to drop it, which left the local prediction rewinding to a
  //  standstill on every correction.
  vx:     number;
  vy:     number;
  vz:     number;
  wx:     number;
  wy:     number;
  wz:     number;

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

export class RaceTransport extends ModeTransportBase<RaceStateType, RaceEvent, RaceView, RaceFrame, ViewRacer, NetRacer> {

  // Reused in place across rebuilds: nothing outside this file reads either
  //  Map by name (checked against `packages/game/src/race.ts` and the rest of
  //  `engine`), so nobody can be holding one from a tick ago the way
  //  `battle/transport.ts`'s `playersById` is. The `racers` ARRAY and each
  //  `ViewRacer` inside it stay freshly allocated every rebuild regardless.
  private readonly racersById       = new Map<string, ViewRacer>()
  private readonly racersByNetIndex = new Map<number, ViewRacer>()

  connect (options: RaceConnectOptions): void {
    void this.link.connect({
      room:    'race',
      state:   RaceState as never,
      name:    options.name,
      server:  options.server,
      options: { trackId: options.trackId, shipId: options.shipId },
    })
  }

  pushInput (input: RaceInput, clientTick: number) {
    return this.link.pushInput(fromRaceInput(input, clientTick))
  }

  protected rosterEntries (): Iterable<[string, { netIndex: number }]> {
    return this.link.state?.racers ?? []
  }

  protected buildFrame (state: RaceStateType, snapshot: Snapshot | null): RaceFrame {
    const poses = this.refillPoses(snapshot)

    const racers: ViewRacer[] = []
    this.racersById.clear()
    this.racersByNetIndex.clear()
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
        vx:       pose?.vx ?? 0,
        vy:       pose?.vy ?? 0,
        vz:       pose?.vz ?? 0,
        wx:       pose?.wx ?? 0,
        wy:       pose?.wy ?? 0,
        wz:       pose?.wz ?? 0,
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
      this.racersById.set(id, racer)
      this.racersByNetIndex.set(entry.netIndex, racer)
    }

    const remotes = this.joinRemotes(this.racersByNetIndex, (racer, remote) => ({
      id:     racer.id,
      name:   racer.name,
      interp: remote.interp,
      state:  racer,
    }))

    return {
      tick:      state.serverTick,
      status:    state.status as RaceStatus,
      countdown: state.countdown,
      trackId:   state.trackId,
      laps:      state.laps,
      racers,
      racersById:        this.racersById,
      racersByNetIndex:  this.racersByNetIndex,
      remotes,
      remotesById:       this.remotesById,
      remotesByNetIndex: this.remotesByNetIndex,
      local:     this.racersByNetIndex.get(this.link.netIndex) ?? null,
    }
  }
}
