/**
 * Two leaf packages declare the fixed step: `Φclock` (rapier's dt and the
 * client accumulator) and `Ξrates` (the server tick and the codec's tick
 * maths). Leaves cannot import each other, so nothing in the type system keeps
 * them one number — this tripwire does. A drift here would not fail a single
 * unit test; it would just make every prediction correct at the wrong rate.
 */

import { describe, expect, it } from 'vitest'

import { STEP as PHYSICS_STEP } from 'Φclock'
import { STEP as NET_STEP, TICK_HZ } from 'Ξrates'


describe('fixed step', () => {
  it('is declared identically in physics and net', () => {
    expect(PHYSICS_STEP).toBe(NET_STEP)
    expect(NET_STEP).toBe(1 / TICK_HZ)
  })
})
