import { describe, expect, it } from 'vitest'
import { createFrameBudget } from '../src/engine/render/quality'


describe('render frame budget', () => {
  it('reduces pixel density after sustained slow frames', () => {
    const budget = createFrameBudget(1.5)
    let changed: number | null = null

    for (let i = 0; i < 240; i++)
      changed = budget.sample(1 / 45) ?? changed

    expect(changed).toBe(1.25)
    expect(budget.p95Ms).toBeGreaterThan(18.5)
  })

  it('does not mistake a suspended tab for a slow gpu', () => {
    const budget = createFrameBudget(1.25)

    for (let i = 0; i < 240; i++)
      budget.sample(i % 20 === 0 ? 2 : 1 / 60)

    expect(budget.pixelRatio).toBe(1.25)
  })

  it('never scales below the legibility floor', () => {
    const budget = createFrameBudget(1)

    for (let i = 0; i < 1_000; i++)
      budget.sample(1 / 30)

    expect(budget.pixelRatio).toBe(0.75)
  })
})
