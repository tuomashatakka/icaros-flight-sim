/**
 * Battle's client transport.
 *
 * Thin on purpose. The netcode — clock, interpolation buffer, input pump,
 * delta baselines — is `RoomLink`, shared with race; Colyseus owns the socket,
 * the reconnection and the schema. What is left here is battle's own shape:
 * merging the two channels back into one view the scene can read.
 *
 * That merge is the interesting part. A pilot's identity, score, lock and
 * objectives arrive on the Schema channel at 20 Hz; their pose, velocity and
 * health arrive bit-packed at 30 Hz keyed by a uint16. Neither channel could do
 * the other's job — Schema cannot quantise a quaternion, and a hand-rolled
 * codec has no business re-implementing map deltas and late-join replay — so
 * they are joined here, on `netIndex`.
 *
 * The 541-line hand-written wire protocol this replaced is gone: the schema IS
 * the contract now, and both halves import the same classes.
 */

import { BattleState } from '@crash-velocity/battle/state'
import { AIM_NORMALISER } from '@crash-velocity/battle/snapshot'
import { fromBattleInput } from '@crash-velocity/battle/input'

import { RoomLink } from '../net/room-link'

import type { NetBodyInterpolator, ShipState } from '@crash-velocity/net'
import type { BattleStateType } from '@crash-velocity/battle/state'
import type { BattleEvent, BattleInput, BattleStatus, Beam } from '@crash-velocity/battle/types'
import type { BattleTeam } from '@crash-velocity/battle/arena'
import type { Loadout, LockPhase } from '@crash-velocity/battle/weapons'
import type { ShipId } from '@crash-velocity/physics/ships'
import type { NetStats } from '../net/room-link'


export type { NetStats }
export { resolveServerUrl } from '../net/room-link'

// One pilot, both channels joined. Field names match what the scene already
//  reads, because the merge is an implementation detail and not a new concept.
export type ViewPlayer = {
  id:           string;
  team:         BattleTeam;
  name:         string;
  shipId:       ShipId;
  health:       number;
  maxHealth:    number;
  boost:        number;
  x:            number;
  y:            number;
  z:            number;
  qx:           number;
  qy:           number;
  qz:           number;
  qw:           number;
  kills:        number;
  deaths:       number;
  primaryCd:    number;
  secondaryCd:  number;
  lockPhase:    LockPhase;
  lockTarget:   string | null;
  lockMeter:    number;
  aimAngle:     number;
  respawnIndex: number;
}

export type BattleView = {
  tick:      number;
  status:    BattleStatus;
  countdown: number;
  timeLeft:  number;
  scores:    Record<BattleTeam, number>;
  players:   readonly ViewPlayer[];
  zones:     ReadonlyArray<{ id: string; owner: BattleTeam | null; progress: number; capturing: BattleTeam | null; contested: boolean }>;
  flags:     ReadonlyArray<{ team: BattleTeam; state: string; carrierId: string | null; x: number; y: number; z: number }>;
  beams:     readonly Beam[];
}

type ViewZone = BattleView['zones'][number]
type ViewFlag = BattleView['flags'][number]

export type BattleFrame = BattleView & {
  readonly playersById:       ReadonlyMap<string, ViewPlayer>;
  readonly namesById:         ReadonlyMap<string, string>;
  readonly playersByNetIndex: ReadonlyMap<number, ViewPlayer>;
  readonly remotes:           readonly NetRemote[];
  readonly remotesById:       ReadonlyMap<string, NetRemote>;
  readonly remotesByNetIndex: ReadonlyMap<number, NetRemote>;
  readonly zonesById:         ReadonlyMap<string, ViewZone>;
  readonly flagsByTeam:       ReadonlyMap<BattleTeam, ViewFlag>;
  readonly flagsByCarrierId:  ReadonlyMap<string, ViewFlag>;
  readonly local:             ViewPlayer | null;
}

export type NetRemote = {
  id:     string;
  team:   BattleTeam;
  name:   string;
  interp: NetBodyInterpolator;
  state:  ViewPlayer;
}

export type ConnectOptions = {
  name:     string;
  shipId:   ShipId;
  loadout?: Loadout;
  match?:   string;
  server?:  string;
}

// Beams are drawn from the fire event and aged locally. A beam lives about a
//  tenth of a second, so re-sending it in every snapshot sent the same segment
//  three times and then stopped mattering.
const beamsInFlight: Beam[] = []

export class BattleTransport {
  private readonly link = new RoomLink<BattleStateType, BattleEvent>()
  private view:         BattleFrame | null = null
  private viewSnapshot: ShipState[] | null = null
  private viewStateVersion = -1

  get clock () {
    return this.link.clock
  }

  connect (options: ConnectOptions): void {
    void this.link.connect({
      room:    'battle',
      state:   BattleState as never,
      name:    options.name,
      server:  options.server,
      options: { shipId: options.shipId, loadout: options.loadout, arenaId: options.match ?? 'apex' },
    })
  }

  close (): void {
    beamsInFlight.length = 0
    this.link.close()
  }

  localNowMs (): number {
    return this.link.localNowMs()
  }

  pushInput (input: BattleInput, clientTick: number) {
    return this.link.pushInput(fromBattleInput(input, clientTick))
  }

  flushInput (interpTick: number): void {
    this.link.flush(interpTick)
  }

  // Dev commands are gone with the hand-rolled protocol; the Colyseus
  //  playground drives a room directly and does it better.
  sendDev (): void {}

  renderTimeMs (): number {
    return this.link.renderTimeMs()
  }

  /**
   * Drain events, and fold the ones that are really state into local buffers.
   *
   * Beams are the case: hitscan resolves server-side and produces a segment
   * with a fuse, which is a fire-and-forget visual rather than anything the
   * next snapshot should keep repeating.
   */
  drainEvents (): BattleEvent[] {
    const events = this.link.drainEvents()

    for (const event of events)
      if (event.type === 'fire' && event.beam)
        beamsInFlight.push({ ...event.beam })

    return events
  }

  // Age the local beam list. Called from the render pass, which is the only
  //  place with a real delta.
  ageBeams (dt: number): void {
    for (let i = beamsInFlight.length - 1; i >= 0; i--) {
      beamsInFlight[i].life -= dt
      if (beamsInFlight[i].life <= 0)
        beamsInFlight.splice(i, 1)
    }
  }

  remotes (): readonly NetRemote[] {
    return this.frame()?.remotes ?? []
  }

  localState (): ViewPlayer | null {
    return this.frame()?.local ?? null
  }

  localId (): string | null {
    const index = this.link.netIndex
    if (index < 0)
      return null

    for (const [ id, entry ] of this.link.state?.players ?? [])
      if (entry.netIndex === index)
        return id
    return null
  }

  localTeam (): BattleTeam {
    return this.localState()?.team ?? 'red'
  }

  unacknowledged () {
    return this.link.unacknowledged()
  }

  serverTick (): number {
    return this.link.serverTick()
  }

  noteCorrection (metres: number): void {
    this.link.noteCorrection(metres)
  }

  stats (): NetStats {
    return this.link.stats()
  }

  /**
   * Join the two channels.
   *
   * Rebuilt when either channel changes. Calls in between return the same
   * read-only frame so every consumer in a render sees one coherent join.
   */
  frame (): BattleFrame | null {
    const state = this.link.state
    const snap  = this.link.latest()
    if (!state)
      return null
    if (this.view && this.viewSnapshot === snap?.ships && this.viewStateVersion === this.link.stateVersion)
      return this.view

    const poses = new Map<number, ShipState>()
    for (const ship of snap?.ships ?? [])
      poses.set(ship.id, ship)

    const players: ViewPlayer[] = []
    const playersById           = new Map<string, ViewPlayer>()
    const namesById             = new Map<string, string>()
    const playersByNetIndex     = new Map<number, ViewPlayer>()
    for (const [ id, entry ] of state.players) {
      const pose               = poses.get(entry.netIndex)
      const player: ViewPlayer = {
        id,
        team:         entry.team as BattleTeam,
        name:         entry.name,
        shipId:       entry.shipId as ShipId,
        health:       entry.health,
        maxHealth:    entry.maxHealth,
        boost:        entry.boost / 255,
        x:            pose?.x ?? 0,
        y:            pose?.y ?? 0,
        z:            pose?.z ?? 0,
        qx:           pose?.qx ?? 0,
        qy:           pose?.qy ?? 0,
        qz:           pose?.qz ?? 0,
        qw:           pose?.qw ?? 1,
        kills:        entry.kills,
        deaths:       entry.deaths,
        primaryCd:    entry.primaryCd,
        secondaryCd:  entry.secondaryCd,
        lockPhase:    entry.lockPhase as LockPhase,
        lockTarget:   entry.lockTarget || null,
        lockMeter:    entry.lockMeter,
        aimAngle:     (pose?.aim ?? 0) * AIM_NORMALISER,
        respawnIndex: pose?.respawnIndex ?? 0,
      }
      players.push(player)
      playersById.set(id, player)
      namesById.set(id, player.name)
      playersByNetIndex.set(entry.netIndex, player)
    }

    const zones = [ ...state.zones.values() ].map(z => ({
      id:        z.id,
      owner:     (z.owner || null) as BattleTeam | null,
      progress:  z.progress,
      capturing: (z.capturing || null) as BattleTeam | null,
      contested: z.contested,
    }))
    const flags = [ ...state.flags.values() ].map(f => ({
      team:      f.team as BattleTeam,
      state:     f.state,
      carrierId: f.carrierId || null,
      x:         f.x,
      y:         f.y,
      z:         f.z,
    }))
    const zonesById        = new Map(zones.map(zone => [ zone.id, zone ]))
    const flagsByTeam      = new Map(flags.map(flag => [ flag.team, flag ]))
    const flagsByCarrierId = new Map<string, ViewFlag>()
    for (const flag of flags)
      if (flag.carrierId)
        flagsByCarrierId.set(flag.carrierId, flag)

    const remotes: NetRemote[] = []
    const remotesById          = new Map<string, NetRemote>()
    const remotesByNetIndex    = new Map<number, NetRemote>()
    for (const remote of this.link.remotes()) {
      const player = playersByNetIndex.get(remote.netIndex)
      if (!player)
        continue

      const joined = { id: player.id, team: player.team, name: player.name, interp: remote.interp, state: player }
      remotes.push(joined)
      remotesById.set(joined.id, joined)
      remotesByNetIndex.set(remote.netIndex, joined)
    }

    this.viewSnapshot     = snap?.ships ?? null
    this.viewStateVersion = this.link.stateVersion
    this.view             = {
      tick:      state.serverTick,
      status:    state.status as BattleStatus,
      countdown: state.countdown,
      timeLeft:  state.timeLeft,
      scores:    { red: state.scoreRed, blue: state.scoreBlue },
      players,
      playersById,
      namesById,
      playersByNetIndex,
      zones,
      zonesById,
      flags,
      flagsByTeam,
      flagsByCarrierId,
      remotes,
      remotesById,
      remotesByNetIndex,
      local:     playersByNetIndex.get(this.link.netIndex) ?? null,
      beams:     beamsInFlight,
    }

    return this.view
  }

  latest (): BattleView | null {
    return this.frame()
  }
}
