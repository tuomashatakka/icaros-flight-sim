/**
 * The tick-cost histogram turns "the report's numbers" into "this process's
 * numbers", so what matters here is the two ways that could quietly lie: a
 * percentile computed wrong, and a ring that keeps stale samples once it
 * wraps past its 600-sample window.
 */
import { describe, expect, it } from 'vitest'
import { TickHistogram, registerTickStats, tickStatsSummary, unregisterTickStats } from 'Ξtick-stats'


describe('TickHistogram', () => {
  it('reports an empty summary before anything is recorded', () => {
    expect(new TickHistogram().summary()).toEqual({ samples: 0, p50Us: 0, p95Us: 0, maxUs: 0 })
  })

  it('computes percentiles over a known 1..100 sequence', () => {
    const histogram = new TickHistogram()
    for (let us = 1; us <= 100; us++)
      histogram.record(us)

    expect(histogram.summary()).toEqual({ samples: 100, p50Us: 50, p95Us: 95, maxUs: 100 })
  })

  it('keeps only the newest 600 samples once the ring wraps', () => {
    const histogram = new TickHistogram()
    for (let us = 1; us <= 700; us++)
      histogram.record(us)

    // The oldest 100 (1..100) are gone; the ring now holds exactly 101..700.
    expect(histogram.summary()).toEqual({ samples: 600, p50Us: 400, p95Us: 670, maxUs: 700 })
  })
})

describe('tickStatsSummary', () => {
  it('has no capacity estimate with nothing registered', () => {
    expect(tickStatsSummary()).toEqual({
      rooms:           {},
      all:             { samples: 0, p50Us: 0, p95Us: 0, maxUs: 0 },
      roomsPerProcess: null,
    })
  })

  it('merges every registered room into one process-wide picture', () => {
    const a = new TickHistogram()
    const b = new TickHistogram()
    for (let us = 1; us <= 100; us++)
      a.record(us)
    for (let us = 101; us <= 200; us++)
      b.record(us)

    registerTickStats('room-a', a)
    registerTickStats('room-b', b)

    try {
      const report = tickStatsSummary()

      expect(report.rooms['room-a']).toEqual({ samples: 100, p50Us: 50, p95Us: 95, maxUs: 100 })
      expect(report.rooms['room-b']).toEqual({ samples: 100, p50Us: 150, p95Us: 195, maxUs: 200 })
      // Pooled from both rings' raw samples, not averaged from their summaries
      // — percentiles do not combine that way.
      expect(report.all).toEqual({ samples: 200, p50Us: 100, p95Us: 190, maxUs: 200 })
      expect(report.roomsPerProcess).toBe(Math.floor(16_667 * 0.6 / 190))
    }
    finally {
      unregisterTickStats('room-a')
      unregisterTickStats('room-b')
    }
  })

  it('drops a room from the merge once unregistered', () => {
    const solo = new TickHistogram()
    solo.record(42)

    registerTickStats('solo', solo)
    unregisterTickStats('solo')

    expect(tickStatsSummary()).toEqual({
      rooms:           {},
      all:             { samples: 0, p50Us: 0, p95Us: 0, maxUs: 0 },
      roomsPerProcess: null,
    })
  })
})
