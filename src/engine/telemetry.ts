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
