/**
 * Simulation outputs, module-local.
 *
 * These are results, not input, so they do not belong in app state (modules read
 * state and never write it) and they must not go through zustand at 60 Hz — the
 * HUD is text and bars, and unthrottled writes cost 60 React commits a second.
 * The vehicle module is the only writer; `publish` mirrors it out at ~15 Hz.
 */
export type Telemetry = {
  speed:      number;
  boostMeter: number;
  boosting:   boolean;
  grounded:   boolean;

  /** Monotonic crash counter — `publish` fires one flash per unseen increment. */
  crashSeq: number;

  /** Impact shake magnitude; decays in the render phase on real time. */
  shake: number;
}

export function createTelemetry (): Telemetry {
  return {
    speed:      0,
    boostMeter: 1,
    boosting:   false,
    grounded:   false,
    crashSeq:   0,
    shake:      0,
  }
}

/**
 * Return telemetry to its initial values in place.
 *
 * For the scenario runner. `boostMeter` in particular is drained by the live
 * session and never refilled on its own, so a scripted run that uses boost
 * inherits whatever charge happened to be left — which is the difference
 * between a reproducible trace and a coin flip. Mutates rather than replaces
 * because the vehicle module closed over this object at build time.
 */
export function resetTelemetry (telemetry: Telemetry): void {
  Object.assign(telemetry, createTelemetry())
}
