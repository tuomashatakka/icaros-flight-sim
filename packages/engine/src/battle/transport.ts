/**
 * Battle's client transport.
 *
 * Thin on purpose. The netcode — clock, interpolation buffer, input pump,
 * delta baselines — is `RoomLink`, shared with race; Colyseus owns the socket,
 * the reconnection and the schema. `ModeTransportBase` (see its own doc) is
 * the merge machinery shared with race's transport — the ten `RoomLink`
 * delegates and the memoised `frame()`/`latest()` pair. What is left here is
 * battle's own shape: health, weapons, lock, zones, flags and beams, joined
 * onto `netIndex`.
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

import { BattleState } from 'Ψstate'
import { AIM_NORMALISER } from 'Ψsnapshot'
import { fromBattleInput } from 'Ψinput'

import { ModeTransportBase } from '../net/mode-transport'

import type { NetBodyInterpolator, Snapshot } from 'Ξ'
import type { BattleStateType } from 'Ψstate'
import type { BattleEvent, BattleInput, BattleStatus, Beam } from 'Ψtypes'
import type { BattleTeam } from 'Ψarena'
import type { Loadout, LockPhase } from 'Ψweapons'
import type { ShipId } from 'Φships'
import type { NetStats } from '../net/room-link'


export type { NetStats }
export { resolveServerUrl } from '../net/room-link'

// One pilot, both channels joined. Field names match what the scene already
//  reads, because the merge is an implementation detail and not a new concept.
//  `vx…wz` are the wire's velocities: the codec has always carried them, and
//  this view used to drop them — which left the local prediction rewinding to a
//  standstill on every correction.
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
  vx:           number;
  vy:           number;
  vz:           number;
  wx:           number;
  wy:           number;
  wz:           number;
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

export class BattleTransport extends ModeTransportBase<BattleStateType, BattleEvent, BattleView, BattleFrame, ViewPlayer, NetRemote> {

  // Reused in place across rebuilds — cleared and refilled, never replaced.
  // Checked against every consumer in `packages/game` and `packages/engine`:
  // nothing holds one of these across a tick boundary. `zonesById` /
  // `flagsByTeam` reach `game/src/battle.ts`'s `renderWorld` only via
  // `renderFrame`, which is reassigned earlier in the SAME `onFrame` call that
  // reads them; `flagsByCarrierId` reaches `battle/opponents.ts` the same way,
  // one call further down the same function. `namesById` and `flagsByCarrierId`
  // also reach `publish-battle.ts`, but only via a `snapshot` fetched fresh in
  // that same tick's `update()` — never a retained reference.
  private readonly namesById        = new Map<string, string>()
  private readonly zonesById        = new Map<string, ViewZone>()
  private readonly flagsByTeam      = new Map<BattleTeam, ViewFlag>()
  private readonly flagsByCarrierId = new Map<string, ViewFlag>()

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
    super.close()
  }

  localNowMs (): number {
    return this.link.localNowMs()
  }

  pushInput (input: BattleInput, clientTick: number) {
    return this.link.pushInput(fromBattleInput(input, clientTick))
  }

  // Dev commands are gone with the hand-rolled protocol; the Colyseus
  //  playground drives a room directly and does it better.
  sendDev (): void {}

  /**
   * Drain events, and fold the ones that are really state into local buffers.
   *
   * Beams are the case: hitscan resolves server-side and produces a segment
   * with a fuse, which is a fire-and-forget visual rather than anything the
   * next snapshot should keep repeating.
   */
  drainEvents (): BattleEvent[] {
    const events = super.drainEvents()

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

  localTeam (): BattleTeam {
    return this.localState()?.team ?? 'red'
  }

  protected rosterEntries (): Iterable<[string, { netIndex: number }]> {
    return this.link.state?.players ?? []
  }

  protected buildFrame (state: BattleStateType, snapshot: Snapshot | null): BattleFrame {
    const poses = this.refillPoses(snapshot)

    const players: ViewPlayer[] = []

    // NOT reused, unlike everything else in this file: `game/src/battle.ts`
    //  keeps a whole `BattleFrame` (`renderFrame`) alive across the
    //  physics-update/render boundary specifically so `playerIn()` /
    //  `projectilePoseOf` can read the roster AS IT WAS LAST DRAWN — a tick
    //  late, on purpose, so a burst effect lands where the player can
    //  currently see the ship, not somewhere the screen has not caught up to.
    //  `update()` calls `frame()` too, earlier in that same tick, before
    //  `onFrame` moves `renderFrame` on — so if this Map were mutated in
    //  place, that rebuild would silently rewrite what the STALE `renderFrame`
    //  shows, out from under it, before `playerIn()` ever reads it.
    const playersById       = new Map<string, ViewPlayer>()
    const playersByNetIndex = new Map<number, ViewPlayer>()

    this.namesById.clear()
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
        vx:           pose?.vx ?? 0,
        vy:           pose?.vy ?? 0,
        vz:           pose?.vz ?? 0,
        wx:           pose?.wx ?? 0,
        wy:           pose?.wy ?? 0,
        wz:           pose?.wz ?? 0,
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
      this.namesById.set(id, player.name)
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

    this.zonesById.clear()
    for (const zone of zones)
      this.zonesById.set(zone.id, zone)

    this.flagsByTeam.clear()
    this.flagsByCarrierId.clear()
    for (const flag of flags) {
      this.flagsByTeam.set(flag.team, flag)
      if (flag.carrierId)
        this.flagsByCarrierId.set(flag.carrierId, flag)
    }

    const remotes = this.joinRemotes(playersByNetIndex, (player, remote) => ({
      id:     player.id,
      team:   player.team,
      name:   player.name,
      interp: remote.interp,
      state:  player,
    }))

    return {
      tick:      state.serverTick,
      status:    state.status as BattleStatus,
      countdown: state.countdown,
      timeLeft:  state.timeLeft,
      scores:    { red: state.scoreRed, blue: state.scoreBlue },
      players,
      playersById,
      namesById:         this.namesById,
      playersByNetIndex,
      zones,
      zonesById:         this.zonesById,
      flags,
      flagsByTeam:       this.flagsByTeam,
      flagsByCarrierId:  this.flagsByCarrierId,
      remotes,
      remotesById:       this.remotesById,
      remotesByNetIndex: this.remotesByNetIndex,
      local:             playersByNetIndex.get(this.link.netIndex) ?? null,
      beams:             beamsInFlight,
    }
  }
}
