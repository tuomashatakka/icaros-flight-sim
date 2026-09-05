/**
 * Every initial value and tunable constant the client stores start from.
 * Numbers that belong to a package are re-exported from their owner.
 */

import { DEFAULT_TUNING } from '@crash-velocity/physics/types'
import { DEFAULT_CONFIGS, SHIP_IDS } from '@/lib/ship/registry'
import { vehicleConfig } from '@/lib/utils'
import type {
  BattleSessionState, CameraView, GameplayState, HangarViewState, LockOnState, NetHealth,
  RaceHudState, RaceState, RaceTimers, ShipConfig, ShipId, SpeedLevel,
} from './types'


export { DEFAULT_TUNING }

// --- gameplay -----------------------------------------------------------------

/** Target speed for a zone; the same curve extends the ladder when a race outruns it. */
export const speedLevel = (zone: number): SpeedLevel => ({ zone, speedTarget: 25 * (zone + 1) })

export const INITIAL_SPEED_LEVELS = 10

/** How many zones to append when the ladder runs out. */
export const SPEED_LEVEL_EXTENSION = 5

export const INITIAL_GAMEPLAY: GameplayState = {
  speed:       0,
  takedowns:   0,
  zone:        1,
  speedLevels: Array.from({ length: INITIAL_SPEED_LEVELS }, (_, i) => speedLevel(i + 1)),
  boostMeter:  1,
  crashFlash:  0,
}

// --- race ---------------------------------------------------------------------

export const RACE_COUNTDOWN_S = 3

export const INITIAL_RACE_HUD: RaceHudState = {
  status:          'lobby',
  countdown:       0,
  laps:            3,
  trackId:         'flats',
  currentLap:      1,
  nextCheckpoint:  1,
  checkpointCount: 0,
  loop:            true,
  position:        1,
  gridSize:        1,
  elapsed:         0,
  lapElapsed:      0,
  lapTimes:        [],
  bestLap:         null,
  finished:        false,
  standings:       [],
  linkError:       null,
}

export const initialRaceTimers = (): RaceTimers => ({ elapsed: 0, lapElapsed: 0, countdown: RACE_COUNTDOWN_S })

export function initialRaceState (shipConfig: ShipConfig | null = null): RaceState {
  return {
    steer:       0,
    strafe:      0,
    throttle:    false,
    brake:       false,
    boost:       false,
    resetSeq:    0,
    status:      'lobby',
    targetSpeed: vehicleConfig.maxSpeed,
    shipConfig,
    tuning:      { ...DEFAULT_TUNING },
  }
}

// --- battle -------------------------------------------------------------------

export const IDLE_LOCK: LockOnState = {
  phase:    'idle',
  targetId: null,
  name:     null,
  distance: 0,
  team:     null,
  progress: 0,
}

export const IDLE_NET: NetHealth = {
  rttMs:         0,
  jitterMs:      0,
  synced:        false,
  snapshotAgeMs: 0,
  correctionM:   0,
  pending:       0,
  linkError:     null,
}

export const INITIAL_BATTLE: BattleSessionState = {
  status:      'idle',
  error:       null,
  playerId:    null,
  myName:      null,
  myTeam:      null,
  myShip:      null,
  myHealth:    100,
  maxHealth:   100,
  myBoost:     1,
  myKills:     0,
  myDeaths:    0,
  carrying:    null,
  lockOn:      IDLE_LOCK,
  aimPitch:    0,
  primary:     null,
  secondary:   null,
  countdown:   0,
  timeLeft:    0,
  scores:      { red: 0, blue: 0 },
  scoreTarget: 25,
  roster:      [],
  zones:       [],
  flags:       [],
  toasts:      [],
  killFeed:    [],
  net:         IDLE_NET,
}

/** Toasts kept on screen at once. */
export const TOAST_CAP = 3

/** Kill-feed rows kept on screen at once. */
export const KILL_FEED_CAP = 5

// --- ship ---------------------------------------------------------------------

export const DEFAULT_SHIP: ShipId = 'icaras'

export const SHIP_STORE_KEY = 'ship-config'

// v2: registry-driven — backfills the 7 WipEout ships onto v1 saves.
// v3: the WipEout ships gained real factory defaults now that the sliders drive them.
// v4: afterburner tuning (burnColor/burnIntensity/burnLength/nozzleSpread).
// v5: hull-shape deform, the second livery layer and the armament block. Without
//     the bump a v4 save reaches the loader with bodyWidth undefined and every
//     hull collapses to a zero-scale point.
export const SHIP_STORE_VERSION = 5

/** Fresh factory map for every registered ship. */
export const initialShipConfigs = (): Record<ShipId, ShipConfig> =>
  Object.fromEntries(SHIP_IDS.map(id => [ id, DEFAULT_CONFIGS[id] ])) as Record<ShipId, ShipConfig>

// --- tuning -------------------------------------------------------------------

export const TUNING_STORE_KEY = 'ship-tuning'

export const TUNING_STORE_VERSION = 2

/** Version 1 persisted this yaw default; only that exact value migrates. */
export const LEGACY_DEFAULT_YAW_RATE = 2.4

// --- viewport -----------------------------------------------------------------

export const INITIAL_CAMERA_VIEW: CameraView = 'chase'

export const INITIAL_HANGAR_VIEW: HangarViewState = {
  autoOrbit:  true,
  wireframe:  false,
  flightTilt: true,
  engines:    true,
}
