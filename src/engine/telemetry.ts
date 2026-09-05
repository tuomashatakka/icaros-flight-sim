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

  /** Air-brake deployment 0..1 — drives the wing panels AND the drag force. */
  airbrake: number;

  /**
   * Main-nozzle command as a fraction of rig capacity, 0..1.
   *
   * What the engines are ACTUALLY being asked for this tick, not what a key is
   * doing. The propulsion gauge used to read a hardcoded 0 / 0.72 / 1 derived
   * from two booleans, so it could not show the speed governor backing thrust
   * off, boost adding to it, or station keeping trimming against the brakes.
   */
  thrustCommand: number;

  /**
   * Longitudinal + lateral load, in g, from the frame's velocity change.
   *
   * Smoothed: the raw per-tick delta spikes on every contact impulse and reads
   * as noise rather than as cornering load.
   */
  gLoad: number;

  /** Monotonic crash counter — `publish` fires one flash per unseen increment. */
  crashSeq: number;

  /** Impact shake magnitude; decays in the render phase on real time. */
  shake: number;
}

export function createTelemetry (): Telemetry {
  return {
    speed:         0,
    boostMeter:    1,
    boosting:      false,
    grounded:      false,
    airbrake:      0,
    thrustCommand: 0,
    gLoad:         0,
    crashSeq:      0,
    shake:         0,
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
