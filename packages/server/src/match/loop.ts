/**
 * The fixed-rate driver every room ticks on.
 *
 * The timestep arithmetic is `createSimClock` from `@crash-velocity/physics/clock` — the same
 * accumulator the browser runs, not a second implementation that drifts from it
 * by a subtle detail. It is importable here because it is pure: its only import
 * is a `type`.
 *
 * What is NOT shared is the scheduling. The client is driven by
 * `requestAnimationFrame`; a server has to schedule itself, and `setInterval`
 * accumulates error because it re-arms from when the callback *ran* rather than
 * when it was *due*. So each wake-up is a `setTimeout` aimed at an absolute
 * deadline.
 */

import { createSimClock } from '@crash-velocity/physics/clock'


export type LoopStats = {

  /**
   * Times the accumulator overflowed `maxSubSteps` and dropped time.
   *
   * `createSimClock` drops overflow rather than replaying it, which is right for
   * a render loop — it degrades to a slower sim instead of a catch-up spiral.
   * On a server it means the match clock silently falls behind wall time, and
   * every connected client's clock sync reads that as a stall. So it is counted
   * and surfaced on `/health` rather than swallowed.
   */
  overflows: number;

  ticks:      number;
  maxTickMs:  number;
  lastTickMs: number;
}

export type Loop = {
  readonly stats:   LoopStats;
  readonly running: boolean;
  start (): void;
  stop (): void;
}

export type LoopOptions = {
  hz: number;

  /** One simulation tick. `dt` is always exactly the fixed step. */
  onTick (dt: number): void;

  /** Injectable so a test can drive a loop without wall time. */
  now?:      () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?:   (handle: unknown) => void;
}

/** Matches `MAX_SUB_STEPS` in `@crash-velocity/physics/clock`; a full batch means time was dropped. */
const OVERFLOW_STEPS = 5

export function createLoop (options: LoopOptions): Loop {
  const step     = 1 / options.hz
  const stepMs   = 1000 * step
  const now      = options.now ?? (() => performance.now())
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms))
  const cancel   = options.cancel ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))

  const clock            = createSimClock({ step })
  const stats: LoopStats = { overflows: 0, ticks: 0, maxTickMs: 0, lastTickMs: 0 }

  let running         = false
  let handle: unknown = null
  let previous        = 0
  let dueAt           = 0

  function pump (): void {
    if (!running)
      return

    const at    = now()
    const delta = (at - previous) / 1000
    previous    = at

    const steps = clock.advance(delta)
    if (steps.length >= OVERFLOW_STEPS)
      stats.overflows++

    for (const dt of steps) {
      options.onTick(dt)
      stats.ticks++
    }

    const spent      = now() - at
    stats.lastTickMs = spent
    if (spent > stats.maxTickMs)
      stats.maxTickMs = spent

    // Aim at the next absolute deadline rather than "now + step", so scheduling
    // error does not accumulate the way `setInterval` lets it.
    dueAt += stepMs

    // If a tick ran long enough to blow past one or more deadlines, skip whole
    // steps until the next one is genuinely in the future. Landing exactly ON
    // `late` would schedule a zero-delay timer, which is the burst this is here
    // to avoid; the trailing guard covers the float case where the arithmetic
    // lands on the boundary.
    const late = now()
    if (dueAt <= late) {
      dueAt += Math.ceil((late - dueAt) / stepMs) * stepMs
      if (dueAt <= late)
        dueAt = late + stepMs
    }

    handle = schedule(pump, dueAt - late)
  }

  return {
    stats,

    get running () {
      return running
    },

    start () {
      if (running)
        return
      running  = true
      previous = now()
      dueAt    = previous + stepMs
      handle   = schedule(pump, stepMs)
    },

    stop () {
      if (!running)
        return
      running = false
      if (handle !== null)
        cancel(handle)
      handle = null
    },
  }
}
