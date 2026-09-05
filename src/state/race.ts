import { defineStore } from './store'
import { INITIAL_RACE_HUD, RACE_COUNTDOWN_S, initialRaceTimers } from './defaults'
import type { RaceHudState, RaceTimers } from './types'


export const raceStore = defineStore<RaceHudState>(INITIAL_RACE_HUD)

/**
 * The live clocks, as a plain mutable object.
 *
 * These advance every sim step, and writing them into a store at that rate
 * forces 60 React commits a second. The holographic HUD reads these directly
 * at its texture cadence so it stays exact to the millisecond; the store
 * mirrors them on a throttle for React.
 */
export const raceTimers: RaceTimers = initialRaceTimers()

export function resetRaceTimers (countdown = RACE_COUNTDOWN_S): void {
  raceTimers.elapsed    = 0
  raceTimers.lapElapsed = 0
  raceTimers.countdown  = countdown
}

export const raceActions = {

  /** Written by the scene once per publish period. */
  sync: (next: Partial<RaceHudState>) => raceStore.set(next),

  reset: () => {
    resetRaceTimers()
    raceStore.set(INITIAL_RACE_HUD)
  },
}
