import { describe, expect, it } from 'vitest'
import { createQualityController, QUALITY_STAGES } from 'Δengine/quality/controller'

describe('renderer quality controller', () => {
  it('warms up, degrades one ordered step per cooldown, then recovers slowly', () => {
    let now = 0
    const controller = createQualityController({
      preference:        'high',
      initialPreference: 'high',
      now:               () => now,
    })
    controller.resize(1920, 1080)

    for (let i = 0; i < 210; i++) {
      now += 100
      controller.frame(30, 22)
    }
    expect(controller.snapshot().stage).toBe(2)
    expect(controller.snapshot().transitions).toHaveLength(2)
    expect(controller.snapshot().transitions[0].measurements.width).toBe(1920)

    for (let i = 0; i < 650; i++) {
      now += 100
      controller.frame(10, 8)
    }
    const last = controller.snapshot().transitions.at(-1)
    expect(last?.direction).toBe('recover')
    expect(last?.to).toBe((last?.from ?? 0) - 1)
  })

  it('puts cosmetic reductions before gradual internal resolution changes', () => {
    const firstResolutionDrop = QUALITY_STAGES.findIndex((stage, index) =>
      index > 0 && stage.resolutionScale < QUALITY_STAGES[index - 1].resolutionScale
    )
    expect(firstResolutionDrop).toBeGreaterThan(5)
    expect(QUALITY_STAGES[firstResolutionDrop].resolutionScale).toBe(0.9)
  })

  it('lets an emergency override an explicit tier', () => {
    let now = 10_000
    const controller = createQualityController({ preference: 'low', now: () => now })
    for (let i = 0; i < 120; i++)
      controller.frame(55)
    expect(controller.snapshot().stage).toBe(13)
    expect(controller.snapshot().transitions[0].emergency).toBe(true)
  })
})
