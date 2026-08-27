/**
 * The battle sim's data model.
 *
 * Split out of `sim.ts` so the transport, the HUD store and the renderer can
 * name a snapshot or an event without importing the class — and, more to the
 * point, so the rules in `sim.ts` are readable without scrolling past two
 * hundred lines of declarations first. Types only: every value lives with the
 * code that owns it.
 */

import type { BattleTeam, ControlPointDef } from './arena'
import type { LockPhase, LockState, Loadout, WeaponId } from './weapons'
import type { ShipId } from '@/lib/ship/registry'


export type BattleStatus = 'lobby' | 'countdown' | 'live' | 'finished'

export type WeaponSlot = 'primary' | 'secondary'

export type BattleInput = {
  steer:    number;
  throttle: boolean;
  brake:    boolean;
  boost:    boolean;

  /** Primary trigger — the beam slot. */
  fire: boolean;

  /** Secondary trigger — the missile slot, gated on a full lock. */
  fireSecondary?: boolean;
  reverse?:       boolean;
  strafe?:        number;

  /**
   * R/F vertical aim axis, -1..1. Held, not an angle — the sim integrates it
   * into `BattlePlayer.aimAngle` so the trim survives a netcode round-trip and
   * a replay reproduces it from the input stream alone.
   */
  aimPitch?: number;
  resetSeq:  number;
}


export type BattlePlayer = {
  id:         string;
  name:       string;
  team:       BattleTeam;
  shipId:     ShipId;
  isBot:      boolean;
  health:     number;
  maxHealth:  number;
  chassis:    import('@dimforge/rapier3d-compat').RigidBody;
  controller: import('@dimforge/rapier3d-compat').DynamicRayCastVehicleController;
  sim:        import('../sim/vehicle-step').HovercraftState;
  controls:   BattleInput;
  boostMeter: number;
  stun:       number;
  loadout:    Loadout;

  /** Seconds remaining before each slot can fire again. */
  cooldown: Record<WeaponSlot, number>;

  /** Live target acquisition. Owned by the sim, mirrored into the HUD. */
  lock: LockState;

  /**
   * Accumulated vertical aim, radians, positive = up.
   *
   * A trim rather than a spring: it stays where you leave it, because the point
   * of it is holding an elevation on a plateau opponent while you manoeuvre.
   * Zeroed on respawn.
   */
  aimAngle:     number;
  carriedFlag:  BattleTeam | null;
  respawnIndex: number;
  lastResetSeq: number;
  kills:        number;
  deaths:       number;
}

export type BattleFlagState = 'home' | 'carried' | 'dropped'

export type BattleFlag = {
  team:      BattleTeam;
  state:     BattleFlagState;
  carrierId: string | null;
  position:  [number, number, number];
  returnIn:  number;

  // Grace period after a drop before ANYONE can re-pick it — stops the stunned
  //  carrier instantly re-catching the objective that just landed at their feet.
  noPickup: number;
}

export type BattleZone = {
  def:   ControlPointDef;
  owner: BattleTeam | null;

  /**
   * Capture meter, 0..1.
   *
   * While `owner` is null it fills toward `capturing`. Once a team owns the
   * zone it means "hold strength": an intruder drains it, and only at zero does
   * the zone go neutral and become capturable again. With no intruder inside it
   * simply stays at 1 — a held point never decays on its own.
   */
  progress:   number;
  capturing:  BattleTeam | null;
  contested:  boolean;
  scoreAccum: number;
}

/** A resolved hitscan shot. Exists only so the renderer can draw it. */
export type Beam = {
  id:        number;
  shooterId: string;
  team:      BattleTeam;
  weapon:    WeaponId;
  from:      [number, number, number];
  to:        [number, number, number];
  life:      number;
  hit:       boolean;
}

export type Missile = {
  id:        number;
  shooterId: string;
  team:      BattleTeam;
  weapon:    WeaponId;
  position:  [number, number, number];
  velocity:  [number, number, number];
  life:      number;

  /** The lock this missile launched against. Missiles never re-target. */
  targetId: string | null;
}

export type BattleSnapshot = {
  tick:      number;
  status:    BattleStatus;
  countdown: number;
  timeLeft:  number;
  scores:    Record<BattleTeam, number>;
  players:   Array<{
    id:        string;
    team:      BattleTeam;
    name:      string;
    shipId:    ShipId;
    health:    number;
    maxHealth: number;
    x:         number;
    y:         number;
    z:         number;
    qx:        number;
    qy:        number;
    qz:        number;
    qw:        number;
    boost:     number;
    stun:      number;
    kills:     number;
    deaths:    number;

    /** Cooldown ratio 0..1 per slot; 0 = ready. */
    primaryCd:   number;
    secondaryCd: number;
    lockPhase:   LockPhase;
    lockTarget:  string | null;
    lockMeter:   number;

    /**
     * Bumped by every respawn. The client watches it to tell a teleport apart
     * from movement: a kill relocates the chassis across the arena, and an
     * interpolator blended across that draws a ship streaking through the
     * level. Carried in the snapshot rather than inferred from the `kill`
     * event so a dropped event cannot cause the smear.
     */
    respawnIndex: number;
  }>;
  zones: Array<{ id: string; owner: BattleTeam | null; progress: number; capturing: BattleTeam | null; contested: boolean }>;
  flags: Array<{
    team:      BattleTeam;
    state:     BattleFlagState;
    carrierId: string | null;
    x:         number;
    y:         number;
    z:         number;
  }>;
  beams:    Beam[];
  missiles: Array<{ id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; team: BattleTeam; weapon: WeaponId }>;
}

export type BattleEvent =
  | { type: 'fire'; id: string; weapon: WeaponId; x: number; y: number; z: number; team: BattleTeam } |
  { type: 'hit'; target: string; hitBy: string; weapon: WeaponId; damage: number } |
  { type: 'tag'; target: string; hitBy: string } |
  { type: 'kill'; target: string; hitBy: string; weapon: WeaponId | null } |
  { type: 'lock'; id: string; target: string } |
  { type: 'flagTaken'; team: BattleTeam; by: string } |
  { type: 'flagDropped'; team: BattleTeam; x: number; z: number } |
  { type: 'flagReturned'; team: BattleTeam } |
  { type: 'flagScored'; team: BattleTeam; by: string; score: number } |
  { type: 'zoneChange'; id: string; owner: BattleTeam | null } |
  { type: 'matchStart' } |
  { type: 'matchEnd'; scores: Record<BattleTeam, number> }

export type BattleConfig = {
  matchTime:        number;
  scoreTarget:      number;
  captureBonus:     number;
  zoneScore:        number;
  stunDuration:     number;
  contactSpeed:     number;
  flagPickupRadius: number;
  baseRadius:       number;

  /** Radius of a ship for the hitscan/blast tests. */
  hullRadius: number;
}
