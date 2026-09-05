/**
 * Client ↔ server clock synchronisation.
 *
 * Everything the client renders for a remote ship happens on SERVER time, not
 * local time. Without this, the interpolation clock drifts against the stream
 * it is interpolating and every remote ship micro-stutters forever — which is
 * the actual shape of "battle mode is jittery", not a physics problem.
 *
 * The estimator is NTP's, reduced to what a game needs:
 *
 *   offset = serverTimeMs + rtt / 2 − t1
 *
 * with three refinements that matter over a real connection:
 *
 * 1. **Keep a window, not a sample.** One packet that queued behind a buffer
 *    reports an offset that is wrong by the whole delay.
 * 2. **Prefer the fastest round trips.** A sample's error is bounded by its own
 *    RTT, so the quickest replies in the window are the most trustworthy — this
 *    is why the estimate is the median of the fastest third rather than of
 *    everything.
 * 3. **Slew, never jump.** A corrected offset applied instantly makes every
 *    interpolated ship teleport. The offset walks to its target at a bounded
 *    rate instead, so a correction is absorbed over a few frames.
 */

/** Round trips kept. At one ping per second this is half a minute of history. */
const WINDOW = 24

/** Fraction of the window (fastest first) the estimate is taken from. */
const TRUSTED_FRACTION = 1 / 3

/**
 * Ceiling on offset correction, ms per second of real time.
 *
 * 50 ms/s closes a quarter-second error in five seconds while staying well
 * under the interpolation buffer, so the correction never outruns the thing it
 * is correcting.
 */
const SLEW_RATE = 50

/** Past this, the connection has changed rather than drifted — snap instead. */
const SNAP_THRESHOLD = 1000

/**
 * Samples before the estimate is trusted enough to slew rather than snap.
 *
 * The first round trips of a session are the worst ones: the main thread is
 * still loading rapier's WASM and the ship meshes, so a reply can sit in the
 * queue for seconds and report an offset wrong by half of that. Taking such a
 * sample whole and then correcting it at the slew rate would mean tens of
 * seconds of visibly wrong interpolation. Until the window holds enough to pick
 * a good sample from, each new estimate is adopted outright — nothing is being
 * rendered smoothly yet for a snap to disturb.
 */
const WARMUP = 5

export type ClockSample = {
  rttMs:    number;
  offsetMs: number;

  /** Arrival order. Breaks RTT ties in favour of the newer sample. */
  at: number;
}

export type ClockStats = {
  rttMs:    number;
  jitterMs: number;
  samples:  number;
  synced:   boolean;
}

export class NetClock {
  private samples: ClockSample[] = []
  private received = 0
  private applied = 0
  private target = 0
  private lastAt = 0
  private started = false


  /**
   * Fold in one completed round trip.
   *
   * @param t0           local time the ping was sent, echoed by the server
   * @param serverTimeMs the server's clock when it replied
   * @param t1           local time the pong arrived
   */
  accept (t0: number, serverTimeMs: number, t1: number): void {
    const rttMs = t1 - t0
    if (!Number.isFinite(rttMs) || rttMs < 0)
      return

    // Half the round trip is the best available guess at one-way delay; it is
    // wrong whenever the path is asymmetric, and there is no way to do better
    // without cooperation from the network.
    const offsetMs = serverTimeMs + rttMs / 2 - t1

    this.samples.push({ rttMs, offsetMs, at: this.received++ })
    if (this.samples.length > WINDOW)
      this.samples.shift()

    this.target = this.estimate()

    if (this.samples.length <= WARMUP) {
      this.applied = this.target
      this.started = true
    }
  }

  /**
   * The median offset of the fastest third of the window.
   *
   * Median rather than mean because one badly queued reply should not drag the
   * estimate at all, rather than drag it a little.
   *
   * Ties break toward the NEWER sample, and that matters more than it looks: on
   * a stable connection every round trip measures the same, so a plain sort by
   * RTT is stable and quietly selects the OLDEST third instead of the fastest —
   * anchoring the clock to samples half a minute old and leaving it unable to
   * follow real drift.
   */
  private estimate (): number {
    const byRtt   = [ ...this.samples ].sort((a, b) => a.rttMs - b.rttMs || b.at - a.at)
    const trusted = byRtt.slice(0, Math.max(1, Math.ceil(byRtt.length * TRUSTED_FRACTION)))
    const offsets = trusted.map(s => s.offsetMs).sort((a, b) => a - b)
    const mid     = Math.floor(offsets.length / 2)

    return offsets.length % 2 === 0
      ? (offsets[mid - 1] + offsets[mid]) / 2
      : offsets[mid]
  }

  /**
   * Server time now, given the local clock.
   *
   * Walks the applied offset toward the estimate as a side effect, so callers
   * get a continuously-correcting clock without having to tick it themselves.
   */
  now (localNowMs: number): number {
    if (!this.started)
      return localNowMs

    const elapsed = this.lastAt === 0 ? 0 : Math.max(0, localNowMs - this.lastAt)
    this.lastAt   = localNowMs

    const error = this.target - this.applied
    if (Math.abs(error) > SNAP_THRESHOLD)
      // A suspend/resume, a reconnect, or a server restart. Slewing a gap this
      // size would take minutes of visibly wrong interpolation.
      this.applied = this.target
    else {
      const step = Math.min(Math.abs(error), SLEW_RATE * elapsed / 1000)
      this.applied += Math.sign(error) * step
    }

    return localNowMs + this.applied
  }

  /** Offset without advancing the slew — for readouts and tests. */
  peek (localNowMs: number): number {
    return this.started ? localNowMs + this.applied : localNowMs
  }

  get synced (): boolean {
    return this.started
  }

  /**
   * Round trip and jitter as robust statistics, not a moving average.
   *
   * An EMA that has just absorbed a four-second load stall goes on reporting
   * seconds of latency long after the connection recovered — so the HUD lies
   * exactly when someone is reading it to diagnose something. Median and
   * median-absolute-deviation shrug that sample off, the same way the offset
   * estimator does.
   */
  get stats (): ClockStats {
    if (!this.samples.length)
      return { rttMs: 0, jitterMs: 0, samples: 0, synced: this.started }

    const rtts   = this.samples.map(sample => sample.rttMs).sort((a, b) => a - b)
    const median = rtts[Math.floor(rtts.length / 2)]
    const spread = rtts.map(r => Math.abs(r - median)).sort((a, b) => a - b)

    return {
      rttMs:    Math.round(median),
      jitterMs: Math.round(spread[Math.floor(spread.length / 2)]),
      samples:  this.samples.length,
      synced:   this.started,
    }
  }

  /** Drop everything. A reconnect must not interpolate on the old server's clock. */
  reset (): void {
    this.samples  = []
    this.received = 0
    this.applied  = 0
    this.target   = 0
    this.lastAt   = 0
    this.started  = false
  }
}
