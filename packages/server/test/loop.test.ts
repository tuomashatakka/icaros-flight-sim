/**
 * The loop is scheduling, so it is tested with injected time — a real
 * `setTimeout` test would be slow, flaky, and would not let us reproduce the
 * cases that matter (a tick that runs long, a process that stalls).
 */
import { describe, expect, it } from 'vitest'
import { createLoop } from '../src/match/loop'


/** A controllable clock plus the single pending timer the loop schedules. */
function harness (hz = 60) {
  let at                                                = 0
  let pending: { fn: () => void; dueAt: number } | null = null
  const ticks: number[] = []

  const loop = createLoop({
    hz,
    onTick:   dt => ticks.push(dt),
    now:      () => at,
    schedule: (fn, ms) => {
      pending = { fn, dueAt: at + ms }
      return pending
    },
    cancel: () => {
      pending = null
    },
  })

  /** Advance wall time by `ms` and fire the timer if it came due. */
  const advance = (ms: number) => {
    at += ms
    if (pending && pending.dueAt <= at) {
      const due = pending
      pending = null
      due.fn()
    }
  }

  return { loop, ticks, advance, at: () => at, pending: () => pending }
}

describe('createLoop', () => {
  it('emits ticks at the configured rate', () => {
    // Advanced in 1 ms slices rather than exact step multiples: stepping by
    // precisely 1/60 s puts the accumulator on a floating-point knife edge and
    // tests arithmetic luck instead of the loop.
    const h = harness(60)
    h.loop.start()

    for (let i = 0; i < 1000; i++)
      h.advance(1)

    expect(h.ticks).toHaveLength(60)
    expect(h.ticks.every(dt => Math.abs(dt - 1 / 60) < 1e-9)).toBe(true)
  })

  it('always hands the sim the exact fixed step, never the real delta', () => {
    // This is the whole reason the sim can be replayed: `dt` is a constant, so
    // a slow frame changes how many steps run, never how big one is.
    const h = harness(60)
    h.loop.start()
    h.advance(100)

    expect(h.ticks.length).toBeGreaterThan(1)
    expect(new Set(h.ticks).size).toBe(1)
  })

  it('catches up a short stall with extra steps', () => {
    const h = harness(60)
    h.loop.start()
    h.advance(1000 / 60 * 3)

    expect(h.ticks).toHaveLength(3)
  })

  it('counts an overflow rather than spiralling to catch up', () => {
    // `createSimClock` caps at 5 sub-steps and DROPS the remainder. On a server
    // that means the match clock silently falls behind wall time, so it has to
    // be visible.
    const h = harness(60)
    h.loop.start()
    h.advance(2000)

    expect(h.ticks).toHaveLength(5)
    expect(h.loop.stats.overflows).toBe(1)
    expect(h.loop.stats.ticks).toBe(5)
  })

  it('re-arms against absolute deadlines so error does not accumulate', () => {
    const h = harness(60)
    h.loop.start()

    // 200 wake-ups at a slightly late 17 ms each. A loop that re-armed from
    // "now" would drift steadily behind; one aimed at deadlines stays close.
    for (let i = 0; i < 200; i++)
      h.advance(17)

    const expected = Math.floor(200 * 17 / (1000 / 60))
    expect(Math.abs(h.loop.stats.ticks - expected)).toBeLessThanOrEqual(2)
  })

  it('does not fire a burst of zero-delay timers after a long tick', () => {
    const h = harness(60)
    h.loop.start()
    h.advance(500)

    const next = h.pending()
    expect(next).not.toBeNull()
    expect(next!.dueAt).toBeGreaterThan(h.at())
  })

  it('stops cleanly and ignores a second start', () => {
    const h = harness(60)
    h.loop.start()
    h.advance(1000 / 60)
    expect(h.loop.running).toBe(true)

    h.loop.start()
    h.loop.stop()
    expect(h.loop.running).toBe(false)

    const before = h.ticks.length
    h.advance(1000)
    expect(h.ticks).toHaveLength(before)
  })
})
