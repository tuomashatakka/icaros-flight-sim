/**
 * Every client-side state shape, in one file.
 *
 * Types that belong to a package are re-exported from their owner rather than
 * redeclared, so there is exactly one definition of each.
 */

import type { BattleStatus } from 'Ψsim'
import type { BattleTeam } from 'Ψarena'
import type { BattleEvent } from 'Ψtypes'
import type { LockPhase, WeaponId } from 'Ψweapons'
import type { RaceStatus } from 'Λ'
import type { ShipTuning } from 'Φtypes'
import type { CameraView } from 'Ȼcamera'
import type { ShipConfig, ShipId } from 'Ȼship/registry'


export type { RaceStatus }
export type { ShipTuning }
export type { Transform } from 'Φtypes'
export type { ShipConfig, ShipId, TexturePreset, PaletteName } from 'Ȼship/registry'
export type { CameraView }
export type { BattleEvent }

// --- gameplay (zones, speed, crash flashes) -----------------------------------

export type SpeedLevel = {
  zone:        number;
  speedTarget: number;
}

export type GameplayState = {
  speed:       number;
  takedowns:   number;
  zone:        number;
  speedLevels: SpeedLevel[];
  boostMeter:  number;
  crashFlash:  number;
}

// --- race HUD mirror ----------------------------------------------------------

export type Standing = {
  id:       string;
  name:     string;
  position: number;
  lap:      number;
  bestLap:  number | null;
  finished: boolean;
  isBot:    boolean;
}

/**
 * The race HUD's slice of the server's state: a mirror written by the scene at
 * the publish throttle and read by React. It has no actions that change the
 * race, because a client cannot change a race.
 */
export type RaceHudState = {
  status:    RaceStatus;
  countdown: number;
  laps:      number;
  trackId:   string;

  currentLap:     number;
  nextCheckpoint: number;

  // Track shape, mirrored so the HUD can label "gate 3 of 16" without holding
  // the track itself.
  checkpointCount: number;
  loop:            boolean;
  position:        number;
  gridSize:        number;

  elapsed:    number;
  lapElapsed: number;
  lapTimes:   number[];
  bestLap:    number | null;
  finished:   boolean;

  /** Hull integrity, 0..1. Race has damage now; zero is a wreck. */
  hull: number;

  standings: Standing[];

  /** Why the game server could not be reached, or `null`. */
  linkError: string | null;

  /**
   * Where the link is in its lifecycle — mirrors `RoomLink`'s `RoomLinkState`.
   *
   * Duplicated rather than imported: `Σ` (engine) depends on `Ƨ` (state), not
   * the other way around, so this package cannot import the engine's type any
   * more than `NetHealth` below can import `NetStats`. Optional so the HUD can
   * fall back to "not reconnecting" without every existing `RaceHudState`
   * literal (`INITIAL_RACE_HUD` included) needing the two new fields.
   */
  linkState?: 'idle' | 'joining' | 'connected' | 'reconnecting' | 'lost';

  /** Reconnect attempts made against the current drop. See `linkState`. */
  reconnectAttempt?: number;
}

/** The live clocks: advanced every sim step, read directly by the HUD. */
export type RaceTimers = { elapsed: number; lapElapsed: number; countdown: number }

// --- battle session -----------------------------------------------------------

export type BattleRosterEntry = {
  id:     string;
  name:   string;
  team:   BattleTeam;
  isBot:  boolean;
  kills:  number;
  deaths: number;
}

export type BattleZoneView = {
  id:   string;
  name: string;

  /** 1–2 character code for the pip glyph. */
  short:     string;
  owner:     BattleTeam | null;
  progress:  number;
  capturing: BattleTeam | null;
  contested: boolean;
}

export type BattleFlagView = { team: BattleTeam; state: string; carrierId: string | null }

export type LockOnState = {
  phase:    LockPhase;
  targetId: string | null;
  name:     string | null;
  distance: number;
  team:     BattleTeam | null;

  /** 0..1 acquisition meter. */
  progress: number;
}

export type WeaponView = {
  id: WeaponId;

  /** 1 = just fired, 0 = ready. */
  cooldown: number;

  /** The slot cannot fire without a completed lock. */
  needsLock: boolean;
}

export type KillFeedEntry = {
  key:    string;
  killer: string;
  victim: string;
  weapon: WeaponId | null;
  team:   BattleTeam | null;
}

export type NetHealth = {
  rttMs:         number;
  jitterMs:      number;
  synced:        boolean;
  snapshotAgeMs: number;

  /** Metres the last reconciliation moved the predicted ship. */
  correctionM: number;

  /** Input frames sent but not yet acknowledged. */
  pending: number;

  /** Why the link is down, or `null` while it is up. */
  linkError: string | null;

  /** Where the link is in its lifecycle. See `RaceHudState.linkState`. */
  linkState?: 'idle' | 'joining' | 'connected' | 'reconnecting' | 'lost';

  /** Reconnect attempts made against the current drop. */
  reconnectAttempt?: number;
}

export type BattleSessionStatus = BattleStatus | 'idle' | 'connecting' | 'queued' | 'error'

export type BattleSessionState = {
  status:    BattleSessionStatus;
  error:     string | null;
  playerId:  string | null;
  myName:    string | null;
  myTeam:    BattleTeam | null;
  myShip:    string | null;
  myHealth:  number;
  maxHealth: number;
  myBoost:   number;
  myKills:   number;
  myDeaths:  number;
  carrying:  BattleTeam | null;
  lockOn:    LockOnState;

  /** Normalised R/F vertical aim, -1..1. Drives where the reticle sits. */
  aimPitch:    number;
  primary:     WeaponView | null;
  secondary:   WeaponView | null;
  countdown:   number;
  timeLeft:    number;
  scores:      Record<BattleTeam, number>;
  scoreTarget: number;
  roster:      BattleRosterEntry[];
  zones:       BattleZoneView[];
  flags:       BattleFlagView[];
  toasts:      string[];
  killFeed:    KillFeedEntry[];

  /** Connection health: how far behind the server we are and how hard prediction is being corrected. */
  net: NetHealth;
}

export type BattleJoin = { playerId: string; team: BattleTeam; shipId: string; name: string }

export type BattleChrome = {
  status:       BattleStatus;
  countdown:    number;
  timeLeft:     number;
  scores:       Record<BattleTeam, number>;
  scoreTarget?: number;
  zones:        BattleZoneView[];
  flags:        BattleFlagView[];
}

export type BattlePilot = {
  health:    number;
  maxHealth: number;
  boost:     number;
  kills:     number;
  deaths:    number;
  carrying:  BattleTeam | null;
}

// --- ship customisation -------------------------------------------------------

export type ShipState = {

  /** Per-ship saved configurations. */
  shipConfigs: Record<ShipId, ShipConfig>;

  /** The active config; mirrors `shipConfigs[currentConfig.shipId]`. */
  currentConfig: ShipConfig;
}

// --- live physics tuning ------------------------------------------------------

export type TuningState = {
  tuning: ShipTuning;

  /** Panel open/closed. UI state, but persisted so it stays how you left it. */
  open: boolean;
}

// --- viewport toggles ---------------------------------------------------------

export type CameraViewState = { view: CameraView }

export type HangarViewState = {
  autoOrbit:  boolean;
  wireframe:  boolean;
  flightTilt: boolean;
  engines:    boolean;
}

export type HangarViewToggle = keyof HangarViewState

// --- player settings ----------------------------------------------------------

/**
 * The graphics budget the player asked for.
 *
 * `auto` is the adaptive ladder in `Σquality/controller`: it starts from a
 * hardware guess and walks down (and slowly back up) against measured frame
 * times. The three fixed presets pin a stage and never move off it — a player
 * who chose "high" is told the truth about what "high" costs rather than
 * having it quietly taken away.
 */
export type GraphicsPreset = 'auto' | 'low' | 'medium' | 'high'

/**
 * The drawing buffer's height, in device pixels, or a policy for choosing one.
 *
 * `auto` renders at up to 1.5x the CSS size (and never past 1440 lines), which
 * on a retina laptop is roughly half the pixels of `native` for a picture that
 * the post chain's own AA pass makes hard to tell apart. `native` is the
 * device's full ratio, capped at 2. A number is an absolute target height —
 * what the word "resolution" means to most people — and the width follows the
 * window's aspect.
 */
export type ResolutionSetting = 'auto' | 'native' | '2160' | '1440' | '1080' | '900' | '720' | '540'

/** Frames per second the loop may draw; 0 = as fast as the display refreshes. */
export type FrameCap = 0 | 30 | 60 | 120

export type AntialiasSetting = 'auto' | 'smaa' | 'fxaa' | 'off'

export type ShadowSetting = 'auto' | 'off' | 'low' | 'high'

/** Whether the on-screen thumb controls are drawn. `auto` asks the device. */
export type TouchControlsSetting = 'auto' | 'on' | 'off'

export type SettingsState = {

  // --- graphics ---
  preset:     GraphicsPreset;
  resolution: ResolutionSetting;
  frameCap:   FrameCap;
  antialias:  AntialiasSetting;
  shadows:    ShadowSetting;

  /** The lens chain: bloom, grade, aberration. Off draws the scene straight to the screen. */
  postEffects:  boolean;
  depthOfField: boolean;

  /** Speed streaks and the acceleration smear. */
  motionBlur: boolean;

  /** Chase camera field of view, degrees. The cockpit keeps its own. */
  fov: number;

  // --- camera ---

  /** Impact shake, 0 = none, 1 = as designed. */
  cameraShake: number;

  /** How hard the camera answers thrust, braking and turns, 0..1.5. */
  cameraMotion: number;

  // --- controls ---

  /** Capture the mouse on click, so it steers the ship instead of a cursor. */
  pointerLock:      boolean;
  mouseSensitivity: number;
  invertMouseY:     boolean;
  touchControls:    TouchControlsSetting;
}

// --- engine app state (the race `App<RaceState>` store) -----------------------

/**
 * Holds only what the simulation reads each tick. Sim *outputs* live in
 * module-local telemetry and are mirrored out through `publish.ts`, because
 * modules read state and never write it.
 */
export type RaceState = {
  // --- input: written by engine/input via the frame loop ---
  steer:    number;
  throttle: boolean;
  brake:    boolean;
  strafe:   number;
  boost:    boolean;
  resetSeq: number;

  // --- mirrored in from the client stores by the bridge ---
  status: RaceStatus;

  /** Pre-resolved from (zone, speedLevels) so the sim never scans an array per tick. */
  targetSpeed: number;
  shipConfig:  ShipConfig | null;

  // --- dev ---
  tuning: ShipTuning;
}
