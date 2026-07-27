import type { Clock } from 'threejs-scene';

/**
 * The simulation timestep. This ONE constant is the clock's step, rapier's
 * `world.timestep`, and the `dt` handed to `controller.updateVehicle()`. The
 * handling in `vehicleConfig` is tuned at this rate; changing it changes the
 * feel of every ship.
 */
export const STEP = 1 / 60;

/** Max sim ticks consumed per real frame. Overflow time is DROPPED, not replayed. */
export const MAX_SUB_STEPS = 5;

/**
 * A fixed-step {@link Clock} that also exposes its leftover accumulator.
 *
 * `threejs-scene`'s own clock keeps the accumulator private, but rendering a
 * 60 Hz simulation on a 144 Hz display needs it: the residual IS the fraction
 * of the next step already elapsed in real time, which is exactly the `alpha`
 * to interpolate rigid-body poses at. Deriving it instead from
 * `realElapsed - clock.elapsed()` works right up until the first overflow drop,
 * after which the two diverge permanently and alpha pins at 1.
 */
export interface SimClock extends Clock {
  /** Interpolation factor in [0, 1): how far into the next step we are. */
  alpha(): number;
  /** While paused, `advance` emits no ticks and `alpha` holds — a stable frozen frame. */
  paused: boolean;
}

/**
 * Fixed-step clock with an exposed residual.
 *
 * The advance arithmetic is a deliberate line-for-line mirror of
 * `threejs-scene`'s `createClock` in fixed mode — including zeroing the
 * accumulator on overflow, without which `alpha` would exceed 1 and the
 * renderer would extrapolate past the last solved pose.
 */
export function createSimClock({ step = STEP, maxSubSteps = MAX_SUB_STEPS } = {}): SimClock {
  let accumulator = 0;
  let total = 0;
  let paused = false;
  const out: number[] = []; // reused across calls — zero allocation per frame

  return {
    mode: 'fixed',

    get paused() {
      return paused;
    },
    set paused(value: boolean) {
      paused = value;
    },

    advance(realDelta: number): readonly number[] {
      out.length = 0;
      if (paused) return out;

      accumulator += realDelta;
      while (accumulator >= step && out.length < maxSubSteps) {
        accumulator -= step;
        total += step;
        out.push(step);
      }
      // Overflow (hidden tab, GC pause) is dropped rather than replayed, so the
      // sim slows down instead of entering a catch-up spiral.
      if (out.length >= maxSubSteps) accumulator = 0;

      return out;
    },

    elapsed: () => total,

    alpha: () => accumulator / step,

    reset() {
      accumulator = 0;
      total = 0;
    },
  };
}
