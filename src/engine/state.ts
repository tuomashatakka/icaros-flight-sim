import type { RaceStatus } from '@/hooks/use-race-store'
import type { ShipConfig } from '@/lib/ship/registry'
import { vehicleConfig } from '@/lib/utils'

/** The 7 params the Leva panel used to live-override each step. */
export type ShipTuning = {
  hoverHeight:         number;
  suspensionStiffness: number;
  sideGrip:            number;
  thrust:              number;
  maxYawRate:          number;
  maxBank:             number;
  uprightStrength:     number;
}

export const DEFAULT_TUNING: ShipTuning = {
  hoverHeight:         vehicleConfig.hoverHeight,
  suspensionStiffness: vehicleConfig.suspensionStiffness,
  sideGrip:            vehicleConfig.sideGrip,
  thrust:              vehicleConfig.thrust,
  maxYawRate:          vehicleConfig.maxYawRate,
  maxBank:             vehicleConfig.maxBank,
  uprightStrength:     vehicleConfig.uprightStrength,
}

/**
 * App state for the race scene.
 *
 * Holds only what the simulation reads each tick. Sim *outputs* (speed, boost
 * meter, lap times) deliberately live elsewhere — in module-local telemetry,
 * mirrored out to zustand for the DOM — because modules read state and never
 * write it, so an output field here would be a second copy nothing reads.
 */
export type RaceState = {
  // --- input: written by engine/input via the frame loop ---
  steer:    number;
  throttle: boolean;
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
    throttle:    false,
    boost:       false,
    resetSeq:    0,
    status:      'idle',
    targetSpeed: vehicleConfig.maxSpeed,
    shipConfig,
    tuning:      { ...DEFAULT_TUNING },
  }
}
