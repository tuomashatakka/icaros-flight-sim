import type * as THREE from 'three'
import type { BattleSessionState } from '@/hooks/use-battle-store'
import type { RaceState as RaceSessionState } from '@/hooks/use-race-store'
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

  panX:     number;
  panY:     number;
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
  panX:             number;
  panY:             number;
  aimPitch:         number;
  steer:            number;
  strafe:           number;
  brake:            boolean;
  boost:            boolean;
  target:           THREE.Vector3 | null;
  targetLabel:      string;
  checkpointNumber: number;
  checkpointCount:  number;
}

export type HudActionId =
  | 'menu' |
  'view' |
  'respawn' |
  'boost' |
  'fire-primary' |
  'fire-secondary' |
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
