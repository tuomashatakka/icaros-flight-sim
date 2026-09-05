/**
 * Clock sync is the fix for the actual complaint about battle mode.
 *
 * Remote ships are rendered at a point in SERVER time. If the client's estimate
 * of that clock wobbles, every remote ship wobbles with it — which looks like a
 * physics bug and is not one. So these tests are mostly about the estimator
 * staying calm: under jitter, under a queued outlier, and while correcting.
 */
import { describe, expect, it } from 'vitest'
import { NetClock } from 'Δengine/battle/net-clock'


/**
 * One round trip against a simulated server.
 *
 * `skew` is how far ahead the server's clock runs; `rtt` the round trip. The
 * server is assumed to reply at the midpoint, which is the case the estimator
 * is exactly right about — the asymmetric case is its known blind spot.
 */
function exchange (clock: NetClock, localNow: number, skew: number, rtt: number): void {
  const t0 = localNow
  const t1 = localNow + rtt
  clock.accept(t0, t0 + rtt / 2 + skew, t1)
}

describe('NetClock', () => {
  it('reports local time until it has a sample', () => {
    const clock = new NetClock()
    expect(clock.synced).toBe(false)
    expect(clock.now(5_000)).toBe(5_000)
  })

  it('recovers a constant skew from a single clean round trip', () => {
    const clock = new NetClock()
    exchange(clock, 1_000, 30_000, 40)

    expect(clock.synced).toBe(true)
    expect(clock.now(1_040) - 1_040).toBeCloseTo(30_000, 0)
  })

  it('holds steady through jitter rather than chasing each sample', () => {
    const clock = new NetClock()
    const rtts  = [ 40, 55, 38, 120, 44, 210, 41, 47, 39, 62, 43, 51 ]

    let at = 0
    for (const rtt of rtts) {
      exchange(clock, at, 30_000, rtt)
      at += 1_000
    }

    // Every sample here reports the same true skew, so the estimate must land
    // on it regardless of how noisy the round trips were.
    expect(clock.peek(at) - at).toBeCloseTo(30_000, 0)
  })

  it('ignores a single badly queued reply', () => {
    const clock = new NetClock()

    let at = 0
    for (let i = 0; i < 8; i++, at += 1_000)
      exchange(clock, at, 30_000, 40)

    // A reply that sat in a buffer: its round trip is enormous AND its reported
    // server time is late by the queueing delay. Taken at face value it would
    // shift the clock by hundreds of ms.
    clock.accept(at, at + 20 + 30_000 - 400, at + 900)
    at += 1_000

    expect(clock.peek(at) - at).toBeCloseTo(30_000, 0)
  })

  it('slews toward a correction instead of jumping', () => {
    const clock = new NetClock()

    // Driven at frame cadence throughout, because the slew is rate-limited per
    // second of REAL time — a test that skipped twelve seconds between two
    // `now()` calls would let it correct in one step and prove nothing.
    let at = 0
    const frame = () => {
      at += 16
      return clock.now(at) - at
    }

    // Past warm-up first: the opening samples are adopted outright, so a test
    // that drifted the server before then would be exercising the snap path.
    for (let i = 0; i < 8; i++) {
      exchange(clock, at, 30_000, 40)
      frame()
    }

    // Server drifts 200 ms. Applied instantly, every interpolated ship on
    // screen teleports.
    for (let i = 0; i < 12; i++)
      exchange(clock, at + i * 10, 30_200, 40)

    const afterOneFrame = frame()
    expect(afterOneFrame).toBeLessThan(30_010)
    expect(afterOneFrame).toBeGreaterThan(30_000)

    // ...and gets there. 200 ms at 50 ms/s is four seconds of slewing.
    for (let i = 0; i < 5 * 60; i++)
      frame()
    expect(frame()).toBeCloseTo(30_200, 0)
  })

  it('adopts the opening samples outright rather than slewing from a bad one', () => {
    // The first round trips of a session are the worst: rapier's WASM and the
    // ship meshes are still loading, so a reply can sit in the queue for
    // seconds and report an offset wrong by half of that. Slewing away from
    // that at 50 ms/s would mean tens of seconds of visibly wrong
    // interpolation, and there is nothing on screen yet for a snap to disturb.
    const clock = new NetClock()

    clock.accept(0, 30_000 + 2_000, 4_000)
    expect(clock.now(4_000) - 4_000).toBeGreaterThan(1_000)

    for (let i = 1; i <= 5; i++)
      exchange(clock, 4_000 + i * 100, 30_000, 40)

    // Corrected within a frame of the good samples arriving, not a minute.
    expect(clock.now(4_600) - 4_600).toBeCloseTo(30_000, 0)
  })

  it('snaps rather than slews when the connection itself changed', () => {
    const clock = new NetClock()
    for (let i = 0; i < 8; i++)
      exchange(clock, i * 10, 30_000, 40)
    clock.now(100)

    // A suspend/resume or a server restart. Slewing a gap this size would mean
    // minutes of visibly wrong interpolation, so it snaps — and does so within
    // a single frame, not merely eventually.
    for (let i = 1; i <= 12; i++)
      exchange(clock, 100 + i * 10, 90_000, 40)

    expect(clock.now(120) - 120).toBeCloseTo(90_000, 0)
  })

  it('tracks round trip and jitter for the net-health readout', () => {
    const clock = new NetClock()

    let at = 0
    for (const rtt of [ 40, 44, 38, 42, 40, 46 ]) {
      exchange(clock, at, 0, rtt)
      at += 1_000
    }

    expect(clock.stats.rttMs).toBeGreaterThan(30)
    expect(clock.stats.rttMs).toBeLessThan(60)
    expect(clock.stats.jitterMs).toBeLessThan(20)
    expect(clock.stats.samples).toBe(6)
  })

  it('does not let one stalled reply dominate the reported latency', () => {
    // A moving average that just absorbed a four-second load stall keeps
    // reporting seconds of latency long after the connection recovered, so the
    // HUD lies exactly when someone is reading it to diagnose something.
    const clock = new NetClock()

    clock.accept(0, 2_000, 4_000)

    let at = 4_000
    for (let i = 0; i < 10; i++, at += 1_000)
      exchange(clock, at, 0, 40)

    expect(clock.stats.rttMs).toBeLessThan(100)
  })

  it('refuses a reply that arrives before it was sent', () => {
    const clock = new NetClock()
    clock.accept(1_000, 5_000, 900)
    expect(clock.synced).toBe(false)
  })

  it('forgets everything on reset, so a reconnect does not use the old clock', () => {
    const clock = new NetClock()
    exchange(clock, 0, 30_000, 40)
    expect(clock.synced).toBe(true)

    clock.reset()
    expect(clock.synced).toBe(false)
    expect(clock.now(1_000)).toBe(1_000)
  })
})
