import { describe, expect, it } from 'vitest'
import { capVisualDelta, createCadenceScheduler, MAX_VISUAL_DELTA } from 'Δengine/render/cadence'
import { changedBeyond, publishedControlsChanged, snapshotPublishedControls } from 'Δengine/render/invalidation'
import { createControls } from 'Δengine/input'


describe('render cadence', () => {
  it('keeps display work at every presented frame while dividing other work', () => {
    const cadence = createCadenceScheduler({ fixedHz: 60, snapshotHz: 30, lowFrequencyHz: 10 })
    let fixed     = 0
    let snapshots = 0
    let low       = 0
    for (let i = 0; i < 120; i++) {
      const frame = cadence.advance(1 / 120)
      expect(frame.display).toBe(true)
      fixed += frame.fixedSteps
      snapshots += frame.networkSnapshots
      low += Number(frame.lowFrequency)
    }
    expect(fixed).toBe(60)
    expect(snapshots).toBe(30)
    expect(low).toBe(10)
  })

  it('caps suspension gaps and emits invalidation once', () => {
    const cadence = createCadenceScheduler()
    expect(capVisualDelta(10)).toBe(MAX_VISUAL_DELTA)
    expect(cadence.advance(10).fixedSteps).toBeLessThanOrEqual(5)
    expect(cadence.advance(0).invalidated).toBe(false)
    cadence.invalidate()
    expect(cadence.advance(0).invalidated).toBe(true)
    expect(cadence.advance(0).invalidated).toBe(false)
  })
})

describe('render invalidation', () => {
  it('publishes controls only when a primitive or sequence changes', () => {
    const controls = createControls()
    const before   = snapshotPublishedControls(controls)
    expect(Object.isFrozen(before)).toBe(true)
    expect(publishedControlsChanged(before, snapshotPublishedControls(controls))).toBe(false)
    controls.resetSeq++
    expect(publishedControlsChanged(before, snapshotPublishedControls(controls))).toBe(true)
  })

  it('uses an epsilon without swallowing meaningful changes', () => {
    expect(changedBeyond(1, 1.00001, 0.001)).toBe(false)
    expect(changedBeyond(1, 1.01, 0.001)).toBe(true)
    expect(changedBeyond(Number.NaN, 0, 0.001)).toBe(true)
  })
})
