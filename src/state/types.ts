/**
 * Every client-side state shape, in one file.
 *
 * Types that belong to a package are re-exported from their owner rather than
 * redeclared, so there is exactly one definition of each.
 */

import type { BattleStatus } from '@crash-velocity/battle/sim'
import type { BattleTeam } from '@crash-velocity/battle/arena'
import type { BattleEvent } from '@crash-velocity/battle/types'
import type { LockPhase, WeaponId } from '@crash-velocity/battle/weapons'
import type { RaceStatus } from '@crash-velocity/race'
import type { ShipTuning } from '@crash-velocity/physics/types'
import type { CameraView } from '@/engine/camera/rig'
import type { ShipConfig, ShipId } from '@/lib/ship/registry'


export type { RaceStatus }
export type { ShipTuning }
export type { Transform } from '@crash-velocity/physics/types'
export type { ShipConfig, ShipId, TexturePreset, PaletteName } from '@/lib/ship/registry'
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

  standings: Standing[];

  /** Why the game server could not be reached, or `null`. */
  linkError: string | null;
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
