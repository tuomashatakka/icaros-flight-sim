import type * as THREE from 'three'
import type { BattleSessionState } from '@/hooks/use-battle-store'
import type { RaceHudState as RaceSessionState } from '@/hooks/use-race-store'
import type { ShipTuning } from '../state'
import type { Telemetry } from '../telemetry'


export type HudMode = 'race' | 'battle'

export type RaceHudData = {
  mode:        'race';
  race:        RaceSessionState;
  clocks:      { elapsed: number; lapElapsed: number; countdown: number };
  tuning:      ShipTuning;
  tuningOpen:  boolean;
  shipId:      string;
  zone:        number;
  targetSpeed: number;
}

export type BattleHudData = {
  mode:   'battle';
  battle: BattleSessionState;
}

export type HudData = RaceHudData | BattleHudData

export type HudActions = {
  menu(): void;
  raceAgain(): void;
  toggleTuning(): void;
  resetTuning(): void;
  copyTuning(): Promise<void>;
  setTuning(key: keyof ShipTuning, value: number): void;
  clearToast(key: string): void;
}

export type HudSource = {
  mode:    HudMode;
  read(): HudData;
  actions: HudActions;
}

/**
 * What the scene shell hands the HUD each render frame.
 *
 * A record rather than a positional argument list: the HUD needs a growing set
 * of poses (anchor, lead, aim ray, impact point) and a ten-argument call was
 * already one transposition away from a silent bug. The shell owns one instance
 * and mutates it, so this stays allocation-free.
 */
export type HudViewFrame = {
  elapsed:        number;
  shipPosition:   THREE.Vector3;
  hullQuaternion: THREE.Quaternion;
  throttle:       number;
  cameraBlend:    number;
  camera:         THREE.Camera;

  /** Cockpit anchor: the camera station with the look-around lead applied. */
  hudQuaternion: THREE.Quaternion;

  /** The look-around lead alone, for the hull-framed chase anchor. */
  hudLead: THREE.Quaternion;

  aimPitch: number;
}

/**
 * Render-phase data supplied by the scene shell.
 *
 * The HUD owns presentation and input, but it does not own the camera, vehicle
 * pose, or simulation output. Keeping that boundary explicit lets race and
 * battle share the exact same HUD renderer without either mode reaching into
 * the other's sim.
 */
export type HudFrame = {
  elapsed:          number;
  telemetry:        Telemetry;
  shipPosition:     THREE.Vector3;
  hullQuaternion:   THREE.Quaternion;
  throttle:         number;
  cameraBlend:      number;
  camera:           THREE.Camera;
  hudQuaternion:    THREE.Quaternion;
  hudLead:          THREE.Quaternion;
  aimPitch:         number;
  steer:            number;
  strafe:           number;
  target:           THREE.Vector3 | null;
  targetLabel:      string;
  checkpointNumber: number;
  checkpointCount:  number;

  /**
   * Typical distance between gates on this course, metres.
   *
   * The closure bar used to normalise against a flat 600, which on a tight
   * track pinned it near 1 and never moved.
   */
  gateSpacing: number;

  /** Weapon aim and its predicted impact, when the mode has weapons. */
  sight: HudSight | null;
}

/**
 * Where the guns point and where the shot lands, in world space.
 *
 * Supplied by the mode, not derived by the HUD: only the scene knows the
 * predicted chassis pose, the weapon's reach and the rapier world to ask. The
 * HUD's job is to project it. `null` in modes that have no weapon.
 */
export type HudSight = {

  /** Muzzle the aim ray leaves from. */
  origin: THREE.Vector3;

  /** Unit aim direction — where the GUNS point, not where the camera looks. */
  direction: THREE.Vector3;

  /** First impact along `direction`, ray-marched. Null when nothing is in reach. */
  impact: THREE.Vector3 | null;

  /** Distance to `impact`, or the weapon's reach when it hits nothing. */
  range: number;

  /** True when `impact` is a ship rather than arena geometry. */
  onTarget: boolean;

  /**
   * The DRAWN gun muzzles, world space.
   *
   * Deliberately not `origin`: the sim fires everything from one synthetic
   * point on the centreline, while the hull carries two visible pods. Moving
   * the sim's muzzle would change hit results on a server-authoritative
   * simulation, so the reticle draws the convergence the pods imply instead.
   */
  hardpoints: readonly THREE.Vector3[];
}

export type HudActionId =
  | 'menu' |
  'view' |
  'respawn' |
  'boost' |
  'fire-primary' |
  'fire-secondary' |
  'strafe-left' |
  'strafe-right' |
  'airbrake' |
  'race-again' |
  'tuning-toggle' |
  'tuning-reset' |
  'tuning-copy'

export type HudRegion = {
  id:      string;
  kind:    'button' | 'hold' | 'slider' | 'stick';
  x:       number;
  y:       number;
  width:   number;
  height:  number;
  action?: HudActionId;
  stick?:  'move' | 'aim';
  tuning?: {
    key:  keyof ShipTuning;
    min:  number;
    max:  number;
    step: number;
  };
}

export type HudPanelKey =
  | 'topLeft' |
  'topCenter' |
  'topRight' |
  'center' |
  'bottomLeft' |
  'bottomCenter' |
  'bottomRight'
