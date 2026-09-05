import { describe, expect, it } from 'vitest'
import {
  formatHudClock,
  formatHudRaceTime,
  hudSliderValue,
  shapeHudAxis,
} from 'Σhud/interaction'


describe('hud interaction transforms', () => {
  it('removes stick drift and preserves signed full-scale input', () => {
    expect(shapeHudAxis(0.1)).toBe(0)
    expect(shapeHudAxis(-0.1)).toBe(0)
    expect(shapeHudAxis(1)).toBe(1)
    expect(shapeHudAxis(-1)).toBe(-1)
  })

  it('clamps and steps pointer-driven tuning values', () => {
    expect(hudSliderValue(-20, 10, 100, 200, 2500, 50)).toBe(200)
    expect(hudSliderValue(60, 10, 100, 200, 2500, 50)).toBe(1350)
    expect(hudSliderValue(500, 10, 100, 200, 2500, 50)).toBe(2500)
  })
})

describe('hud clocks', () => {
  it('formats battle and race precision independently', () => {
    expect(formatHudClock(125.999)).toBe('2:05')
    expect(formatHudRaceTime(125.999)).toBe('2:05.999')
    expect(formatHudClock(Number.NaN)).toBe('--:--')
    expect(formatHudRaceTime(Number.POSITIVE_INFINITY)).toBe('--:--.---')
  })
})
