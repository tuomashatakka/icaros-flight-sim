/**
 * Every rate the netcode runs at, in one place, with the reason attached.
 *
 * The numbers come from the architecture document, with one deliberate
 * departure, called out below.
 */

/**
 * Server simulation rate.
 *
 * The document suggests 30 Hz for a hobby browser game. This is 60, and it has
 * to be: `STEP` is simultaneously the client's clock step, rapier's
 * `world.timestep`, and the `dt` that `vehicleConfig` is tuned against. Any
 * other server rate would retune how every ship handles *and* guarantee that
 * client prediction diverges from the server it is predicting. The CPU cost of
 * the extra 30 steps is a rounding error next to that.
 */
export const TICK_HZ = 60

/** Snapshot broadcast rate. Every second tick. The document's 20–30 Hz band. */
export const SNAPSHOT_HZ = 30

/** Input send rate. Matches the sim, and every packet re-sends the unacknowledged tail. */
export const INPUT_HZ = 60

/**
 * How far in the past remote entities are rendered.
 *
 * Two to three snapshots at 30 Hz, so one or two lost packets never empty the
 * interpolation bracket. Source's default is the same 100 ms.
 */
export const INTERP_DELAY_MS = 100

/**
 * How far past the newest pose extrapolation may run before a ship simply
 * holds still. Linear extrapolation of a fast mover reads fine for a few
 * frames and then diverges hard — especially through a collision it cannot
 * know about.
 */
export const EXTRAPOLATE_MAX_MS = 250

/** Lag-compensation history kept, and the furthest back a shot may be rewound. */
export const REWIND_HISTORY_MS = 1000
export const MAX_REWIND_MS = 250

/** Unacknowledged input frames bundled into one packet before the oldest is dropped. */
export const MAX_INPUT_FRAMES = 32

export const STEP = 1 / TICK_HZ

export function ticksPerSnapshot (tickHz = TICK_HZ, snapshotHz = SNAPSHOT_HZ): number {
  if (tickHz % snapshotHz !== 0)
    throw new Error(`snapshotHz (${snapshotHz}) must divide tickHz (${tickHz}) evenly`)
  return tickHz / snapshotHz
}
