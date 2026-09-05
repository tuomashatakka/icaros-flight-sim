/**
 * The error smoother — the half of reconciliation the player actually sees.
 *
 * The server's correction moves the predicted body to the truth immediately,
 * which is right and non-negotiable. What is negotiable is whether the player
 * WATCHES it move. This class banks the jump and hands it back, decaying, so
 * the render walks to meet the body over about a tenth of a second.
 *
 * It went in untested and unused: the client carried a private copy of the same
 * arithmetic whose output was never added to anything, so every correction over
 * the deadband was drawn raw, up to thirty times a second. These tests exist so
 * the offset cannot quietly stop being spent again.
 */

import { describe, expect, it } from 'vitest'

import { DEFAULT_SMOOTHING, ErrorSmoother } from '../src/prediction'


const out = () => ({ x: 0, y: 0, z: 0 })

describe('error smoother', () => {
  describe('classify', () => {
    it('ignores an error inside the deadband', () => {
      expect(new ErrorSmoother().classify(DEFAULT_SMOOTHING.deadband - 0.01, false).tier).toBe('none')
    })

    it('blends between the deadband and the hard snap', () => {
      expect(new ErrorSmoother().classify(1, false).tier).toBe('blend')
    })

    it('snaps past the hard threshold, where continuity is a fiction', () => {
      expect(new ErrorSmoother().classify(DEFAULT_SMOOTHING.hardSnap + 0.01, false).tier).toBe('snap')
    })

    it('snaps a teleport however small, so a respawn never streaks', () => {
      // A respawn that happens to land nearby is still a relocation.
      expect(new ErrorSmoother().classify(0.01, true).tier).toBe('snap')
    })
  })

  describe('the offset', () => {
    it('hands back the jump it absorbed, so the render can lag the body', () => {
      const smoother = new ErrorSmoother()
      smoother.absorb(2, 0, 0)

      // Read at dt 0: no decay yet, so this is the whole banked error.
      expect(smoother.sample(0, out()).x).toBeCloseTo(2, 6)
    })

    it('halves over the configured half-life', () => {
      const smoother = new ErrorSmoother()
      smoother.absorb(1, 0, 0)

      expect(smoother.sample(DEFAULT_SMOOTHING.halfLife, out()).x).toBeCloseTo(0.5, 6)
    })

    it('accumulates corrections that land before the last one has decayed', () => {
      const smoother = new ErrorSmoother()
      smoother.absorb(1, 0, 0)
      smoother.absorb(0.5, 0, 0)

      expect(smoother.sample(0, out()).x).toBeCloseTo(1.5, 6)
    })

    it('reaches exactly zero rather than trailing a denormal forever', () => {
      const smoother = new ErrorSmoother()
      smoother.absorb(1, 1, 1)

      // Sampled at a plausible frame time rather than in one big step, which is
      //  how it is actually driven. A metre on each axis clears in 0.65 s at
      //  60 Hz — the cutoff is on the SUM of the three components, so a
      //  per-axis estimate of it lands short.
      for (let elapsed = 0; elapsed < 1; elapsed += 1 / 60)
        smoother.sample(1 / 60, out())

      expect(smoother.magnitude).toBe(0)
    })

    it('drops everything on clear, for a snap that is not being blended', () => {
      const smoother = new ErrorSmoother()
      smoother.absorb(3, 3, 3)
      smoother.clear()

      expect(smoother.sample(0, out())).toEqual({ x: 0, y: 0, z: 0 })
    })
  })
})
