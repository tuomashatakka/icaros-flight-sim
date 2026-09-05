import { describe, expect, it } from 'vitest'
import { createQualityController, tierDprCap } from '../src/engine/render/quality'

describe('render quality', () => {
  it('uses conservative tier caps', () => {
    expect(tierDprCap('low')).toBe(1)
    expect(tierDprCap('medium')).toBe(1.4)
    expect(tierDprCap('high', 1.6)).toBe(1.6)
  })

  it('drops quickly but recovers only after a longer stable interval', () => {
    const applied: number[] = []
    const quality = createQualityController('high', scale => applied.push(scale), {
      sampleFrames: 3,
      missFrames:   100,
      stableFrames: 5,
      targetMs:     10,
      step:         0.1,
      windowFrames: 3,
    })

    quality.sample(20)
    quality.sample(20)
    quality.sample(20)
    expect(applied).toEqual([0.9])

    for (let i = 0; i < 7; i++)
      quality.sample(1)
    expect(applied).toEqual([0.9, 1])
    expect(quality.transitions.map(change => change.reason)).toEqual(['startup', 'stable'])
  })

  it('quantises and clamps repeated reductions', () => {
    const applied: number[] = []
    const quality = createQualityController('low', scale => applied.push(scale), {
      sampleFrames: 1,
      missFrames:   1,
      targetMs:     10,
      step:         0.2,
      minScale:     0.6,
    })

    for (let i = 0; i < 8; i++)
      quality.sample(20)
    expect(applied).toEqual([0.8, 0.6])
  })
})
