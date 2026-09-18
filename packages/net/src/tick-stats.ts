/**
 * Per-tick cost, measured on the process actually serving traffic.
 *
 * The report's §4 numbers came from a headless harness stepping a sim with
 * nobody driving it; the running server measured nothing of its own. This is
 * that measurement: a fixed ring per room, cheap enough to write on every
 * tick, and a registry so `/health` can fold every live room into one number.
 */

/** 10 s of ticks at the server's 60 Hz — long enough to smooth one GC pause without hiding a real regression. */
const RING_SIZE = 600

export type TickSummary = {
  samples: number;
  p50Us:   number;
  p95Us:   number;
  maxUs:   number;
}

const EMPTY_SUMMARY: TickSummary = { samples: 0, p50Us: 0, p95Us: 0, maxUs: 0 }

/**
 * Percentile by nearest rank, no interpolation.
 *
 * This is a monitoring number, not a statistics paper: `sorted` already holds
 * the whole population a summary is taken over, so the simplest defensible
 * rank is the right one — nothing downstream needs the fractional refinement
 * interpolating between two ranks would add.
 */
function rankAt (sorted: readonly number[], p: number): number {
  return sorted[Math.floor(p * (sorted.length - 1))]
}

function summarise (values: readonly number[]): TickSummary {
  if (values.length === 0)
    return EMPTY_SUMMARY

  const sorted = [ ...values ].sort((a, b) => a - b)
  return {
    samples: sorted.length,
    p50Us:   rankAt(sorted, 0.5),
    p95Us:   rankAt(sorted, 0.95),
    maxUs:   sorted[sorted.length - 1],
  }
}

/**
 * A fixed ring of the last `RING_SIZE` tick costs, in microseconds.
 *
 * `record` is the hot path — called once per `stepOnce`, at 60 Hz, forever —
 * so it is one array write and two integer updates, nothing more. `summary`
 * is not hot: it is read from a `/health` poll, seconds apart, so sorting a
 * copy of 600 numbers there rather than keeping the ring sorted incrementally
 * is the cheap side to pay the cost on.
 */
export class TickHistogram {
  private readonly ring = new Float64Array(RING_SIZE)
  private next = 0
  private filled = 0

  record (us: number): void {
    this.ring[this.next] = us
    this.next            = (this.next + 1) % RING_SIZE
    this.filled          = Math.min(this.filled + 1, RING_SIZE)
  }

  /** The filled portion, oldest first, as a plain copy — never the live ring. */
  samples (): number[] {
    return Array.from({ length: this.filled }, (_, i) => this.ring[(this.next - this.filled + i + RING_SIZE) % RING_SIZE])
  }

  summary (): TickSummary {
    return summarise(this.samples())
  }
}

// --- registry ----------------------------------------------------------------

/**
 * One histogram per live room, keyed by `roomId`.
 *
 * A module-level map rather than something threaded through `/health`'s route
 * handler: Colyseus owns room lifecycle, and `onCreate`/`onDispose` are the
 * only hooks guaranteed to run exactly once per room — routing registration
 * through those is simpler than the server reaching back into every room type
 * it defines.
 */
const registry = new Map<string, TickHistogram>()

export function registerTickStats (id: string, histogram: TickHistogram): void {
  registry.set(id, histogram)
}

export function unregisterTickStats (id: string): void {
  registry.delete(id)
}

export type TickStatsReport = {
  rooms:           Record<string, TickSummary>;
  all:             TickSummary;
  roomsPerProcess: number | null;
}

/** One 60 Hz frame, in microseconds. */
const FRAME_BUDGET_US = 16_667

/**
 * Fraction of a frame the capacity estimate budgets for ticking rooms.
 *
 * Not 1.0: Bun is single-threaded, so every room in the process shares one
 * core with Colyseus's own message pump, GC, and the rest of the event loop.
 * A process sized to spend its *whole* frame on simulation has no slack left
 * for one slow tick to absorb before the next one is already late — 60% is
 * the report's own budget for the sim, leaving the remaining 40% for
 * everything around it.
 */
const FRAME_BUDGET_FRACTION = 0.6

/**
 * Every registered room, merged into one process-wide picture.
 *
 * `all` pools every ring's raw samples rather than averaging the per-room
 * summaries — percentiles do not combine that way. `roomsPerProcess` is the
 * report's §4 capacity estimate: how many rooms costing `all.p95Us` each could
 * share this process before ticking alone exceeds the frame budget above.
 * `null` rather than `Infinity` while nothing has been measured yet — there is
 * no estimate to report until at least one tick has landed somewhere.
 */
export function tickStatsSummary (): TickStatsReport {
  const rooms: Record<string, TickSummary> = {}
  const merged: number[]                   = []

  for (const [ id, histogram ] of registry) {
    rooms[id] = histogram.summary()
    merged.push(...histogram.samples())
  }

  const all = summarise(merged)

  return {
    rooms,
    all,
    roomsPerProcess: all.samples > 0 ? Math.floor(FRAME_BUDGET_US * FRAME_BUDGET_FRACTION / all.p95Us) : null,
  }
}
