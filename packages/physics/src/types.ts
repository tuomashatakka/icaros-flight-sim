import { vehicleConfig } from './config'

/**
 * Types the physics owns.
 *
 * `Transform` used to be imported from `@/hooks/use-race-store` — the sim
 * reaching into a zustand store module for a four-line type was the single
 * worst dependency edge in the engine, and the thing that would have made
 * lifting the physics into its own package painful. Both are re-exported from
 * their old homes, so nothing outside this package had to change.
 */
export type Transform = {
  position:   [number, number, number];
  quaternion: [number, number, number, number];
}

/** The 7 params the live tuning panel overrides each step. */
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
