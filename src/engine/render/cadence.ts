export const MAX_VISUAL_DELTA = 1 / 15

export function capVisualDelta (delta: number): number {
  return Math.max(0, Math.min(MAX_VISUAL_DELTA, delta))
}

export type CadenceFrame = {
  display:          true;
  fixedSteps:       number;
  networkSnapshots: number;
  lowFrequency:     boolean;
  invalidated:      boolean;
}

export type CadenceOptions = {
  fixedHz?:         number;
  snapshotHz?:      number;
  lowFrequencyHz?:  number;
  maxCatchUpSteps?: number;
}

/**
 * One clock divider for work with different cadences. It is deliberately
 * driven by the scene's existing frame callback: cadence must never imply a
 * second requestAnimationFrame owner.
 */
export function createCadenceScheduler ({
  fixedHz = 60,
  snapshotHz = 30,
  lowFrequencyHz = 10,
  maxCatchUpSteps = 5,
}: CadenceOptions = {}) {
  let fixedDebt    = 0
  let snapshotDebt = 0
  let visualDebt   = 0
  let dirty        = true

  function take (debt: number, period: number, limit: number): [number, number] {
    const count = Math.min(limit, Math.floor((debt + Number.EPSILON) / period))
    return [ count, debt - count * period ]
  }

  return {
    invalidate () {
      dirty = true
    },

    advance (delta: number): CadenceFrame {
      const elapsed = capVisualDelta(delta)
      fixedDebt    += elapsed
      snapshotDebt += elapsed
      visualDebt   += elapsed

      const fixed            = take(fixedDebt, 1 / fixedHz, maxCatchUpSteps)
      const snapshot         = take(snapshotDebt, 1 / snapshotHz, maxCatchUpSteps)
      const fixedSteps       = fixed[0]
      const networkSnapshots = snapshot[0]
      fixedDebt                = fixed[1]
      snapshotDebt             = snapshot[1]

      const lowPeriod    = 1 / lowFrequencyHz
      const lowFrequency = visualDebt + 1e-9 >= lowPeriod
      if (lowFrequency)
        visualDebt = Math.max(0, visualDebt - lowPeriod)

      const invalidated = dirty
      dirty = false
      return { display: true, fixedSteps, networkSnapshots, lowFrequency, invalidated }
    },
  }
}
