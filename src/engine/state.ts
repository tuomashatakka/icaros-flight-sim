import type { RaceStatus } from '@/hooks/use-race-store'
import type { ShipConfig } from '@/lib/ship/registry'
import { vehicleConfig } from '@/lib/utils'

// Defined in the sim layer and re-exported here. The physics may not import
// app code, and `ShipTuning` is a physics input, so it belongs down there.
export { DEFAULT_TUNING } from '@crash-velocity/physics/types'
export type { ShipTuning } from '@crash-velocity/physics/types'
import { DEFAULT_TUNING } from '@crash-velocity/physics/types'
import type { ShipTuning } from '@crash-velocity/physics/types'

/**
 * App state for the race scene.
 *
 * Holds only what the simulation reads each tick. Sim *outputs* (speed, boost
 * meter, lap times) deliberately live elsewhere — in module-local telemetry,
 * mirrored out to zustand for external consumers — because modules read state
 * and never write it, so an output field here would be a second copy nothing
 * reads.
 */
export type RaceState = {
  // --- input: written by engine/input via the frame loop ---
  steer:    number;
  throttle: boolean;
  brake:    boolean;
  strafe:   number;
  boost:    boolean;
  resetSeq: number;

  // --- mirrored in from zustand by the bridge ---
  status: RaceStatus;

  /** Pre-resolved from (zone, speedLevels) so the sim never scans an array per tick. */
  targetSpeed: number;
  shipConfig:  ShipConfig | null;

  // --- dev ---
  tuning: ShipTuning;
}

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
