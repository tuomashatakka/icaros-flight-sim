/**
 * Weapon catalogue and lock-on rules.
 *
 * Plain data + pure helpers, no three.js and no rapier, so the headless sim,
 * the renderer, the HUD and the hangar all read the SAME numbers. The catalogue
 * is deliberately split by `kind`:
 *
 * - `beam` weapons are hitscan. They resolve the moment the trigger goes down
 *   and leave a rendered beam behind them, so there is no projectile to lead.
 * - `missile` weapons are very fast homing projectiles that only launch once
 *   the lock meter is full — the lock is the price of a guided weapon.
 */

export type WeaponKind = 'beam' | 'missile'

export type WeaponId =
  | 'pulse' | 'lance' | 'rail' |
  'hornet' | 'swarm'

export type WeaponSpec = {
  id:    WeaponId;
  kind:  WeaponKind;
  label: string;
  blurb: string;

  /** HUD + tracer colour. */
  color: string;

  /** Seconds between shots. */
  cooldown: number;

  /** Damage per beam / per missile. */
  damage: number;

  /** Metres the shot reaches. */
  range: number;

  /** Rounds launched per trigger pull (swarm racks fire several). */
  count: number;

  /** A full lock is required before the trigger does anything. */
  needsLock: boolean;

  // --- beam only ---
  /** Rendered beam half-width, and the radius used for the hit test. */
  beamWidth?: number;

  /** Seconds the rendered beam stays on screen. */
  beamLife?: number;

  /** Passes through the first target and keeps going. */
  pierce?: boolean;

  // --- missile only ---
  /** Launch speed. These are FAST — the old homing bolt travelled at 95. */
  speed?: number;

  /** Peak turn rate while homing, rad/s. */
  turnRate?: number;

  /** Seconds before the motor burns out. */
  life?: number;

  /** Radius within which the warhead detonates. */
  blastRadius?: number;

  /** Random-ish launch fan for multi-shot racks, radians. */
  spread?: number;
}

export const WEAPONS: Record<WeaponId, WeaponSpec> = {
  pulse: {
    id:        'pulse',
    kind:      'beam',
    label:     'Pulse Repeater',
    blurb:     'Free-aim tracer beams. No lock, no wind-up, low yield.',
    color:     '#ffd34d',
    cooldown:  0.13,
    damage:    5,
    range:     240,
    count:     1,
    needsLock: false,
    beamWidth: 0.09,
    beamLife:  0.07,
  },
  lance: {
    id:        'lance',
    kind:      'beam',
    label:     'Ion Lance',
    blurb:     'Heavy free-aim beam. Slower, hits like a truck.',
    color:     '#ff3d6e',
    cooldown:  0.72,
    damage:    26,
    range:     330,
    count:     1,
    needsLock: false,
    beamWidth: 0.3,
    beamLife:  0.16,
  },
  rail: {
    id:        'rail',
    kind:      'beam',
    label:     'Rail Spike',
    blurb:     'Locked precision shot. Pierces everything on the line.',
    color:     '#9fe6ff',
    cooldown:  2.4,
    damage:    58,
    range:     540,
    count:     1,
    needsLock: true,
    beamWidth: 0.17,
    beamLife:  0.34,
    pierce:    true,
  },
  hornet: {
    id:          'hornet',
    kind:        'missile',
    label:       'Hornet',
    blurb:       'One very fast guided warhead. Needs a full lock.',
    color:       '#ff8a3d',
    cooldown:    1.7,
    damage:      42,
    range:       460,
    count:       1,
    needsLock:   true,
    speed:       300,
    turnRate:    4.6,
    life:        4,
    blastRadius: 5,
  },
  swarm: {
    id:          'swarm',
    kind:        'missile',
    label:       'Swarm Rack',
    blurb:       'Four micro-missiles off one lock. Fans out, converges hard.',
    color:       '#b06bff',
    cooldown:    2.8,
    damage:      16,
    range:       380,
    count:       4,
    needsLock:   true,
    speed:       255,
    turnRate:    6.2,
    life:        3.6,
    blastRadius: 4,
    spread:      0.22,
  },
}

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[]

export const BEAM_WEAPONS  = WEAPON_IDS.filter(id => WEAPONS[id].kind === 'beam')
export const MISSILE_WEAPONS = WEAPON_IDS.filter(id => WEAPONS[id].kind === 'missile')

export type Loadout = {
  primary:   WeaponId;
  secondary: WeaponId;
}

export const DEFAULT_LOADOUT: Loadout = { primary: 'pulse', secondary: 'hornet' }

const deg = (d: number) => Math.cos(d * Math.PI / 180)

/**
 * Lock acquisition, tuned so a lock is a commitment rather than a side effect.
 *
 * Two cones, not one. `acquire` is the tight cone that actually fills the
 * meter; `hold` is a wider ring in which an already-filling lock merely stalls
 * instead of collapsing. A single cone made the meter flicker every time the
 * ship banked, which reads as broken rather than difficult.
 */
export const LOCK = {

  /** Furthest a target can be and still be tracked. */
  range: 430,

  /** cos of the half-angle that FILLS the meter. */
  acquireCos: deg(7),

  /** cos of the half-angle that merely HOLDS it. Outside this, the meter drains. */
  holdCos: deg(14),

  /** Seconds of continuous tracking for a full lock. */
  time: 1.9,

  /** Meter drained per second while the target is outside the hold cone. */
  decay: 1.35,

  /** Seconds outside the acquire cone before draining starts. */
  slipGrace: 0.3,

  /** Seconds a COMPLETED lock survives with the target off-cone or occluded. */
  keepLocked: 0.85,
}

export type LockPhase = 'idle' | 'tracking' | 'locked'

export type LockState = {
  targetId: string | null;

  /** 0..1 acquisition meter. */
  progress: number;
  phase:    LockPhase;

  /** Seconds the target has been outside the acquire cone. */
  slip: number;
}

export function createLockState (): LockState {
  return { targetId: null, progress: 0, phase: 'idle', slip: 0 }
}

/** True when the slot can actually fire right now. */
export function canFire (spec: WeaponSpec, cooldown: number, lock: LockState): boolean {
  if (cooldown > 0)
    return false
  return !spec.needsLock || lock.phase === 'locked'
}
