import { beforeAll, describe, expect, it } from 'vitest'
import { CRASH_CASES } from 'Φlab/cases'
import type { LabTrace } from 'Φlab/cases'
import { runCrashCase } from 'Φlab/run'

/**
 * The crash dummies, as tests.
 *
 * Each lane isolates one physical behaviour against real geometry and asserts
 * the checks the case itself carries. The checks live on the case rather than
 * in here so the visual lab can show the same pass/fail per lane without
 * importing vitest — if the watchable thing and the green thing could disagree
 * about what a case is, neither is worth much.
 *
 * Every case is run ONCE and the trace shared across its assertions; stepping
 * the world again per predicate would be silly.
 */

const traces = new Map<string, LabTrace>()

beforeAll(async () => {
  // Sequential: rapier's wasm is a single instance, and there is no version of
  // "run eight worlds at once" against it that ends well.
  for (const crash of CRASH_CASES)
    traces.set(crash.id, await runCrashCase(crash))
}, 120_000)

describe.each(CRASH_CASES.map(c => [ c.id, c ] as const))('crash dummy: %s', (id, crash) => {
  it.each(crash.checks.map(c => [ c.label, c ] as const))('%s', (_label, check) => {
    expect(check.run(traces.get(id)!)).toBe(true)
  })

  it('captures every tick, not a sample', () => {
    const trace = traces.get(id)!
    expect(trace.frames).toHaveLength(Math.round(crash.duration * 60))
    expect(trace.frames[0].forces.length).toBeGreaterThan(0)
  })
})

describe('determinism', () => {
  // The one that matters most: every check above is downstream of the run being
  // reproducible, and a hash that moves between runs turns all of them into
  // anecdotes.
  it.each(CRASH_CASES.map(c => [ c.id, c ] as const))('%s hashes identically twice', async (id, crash) => {
    const again = await runCrashCase(crash)
    expect(again.hash).toBe(traces.get(id)!.hash)
  }, 60_000)
})
