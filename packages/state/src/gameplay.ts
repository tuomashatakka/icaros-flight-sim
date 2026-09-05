import { defineStore } from './store'
import { INITIAL_GAMEPLAY, SPEED_LEVEL_EXTENSION, speedLevel } from './defaults'
import type { GameplayState } from './types'


export const gameplayStore = defineStore<GameplayState>(INITIAL_GAMEPLAY)

export const gameplayActions = {
  setSpeed:      (speed: number) => gameplayStore.set({ speed }),
  setBoostMeter: (value: number) => gameplayStore.set({ boostMeter: Math.max(0, Math.min(1, value)) }),
  addTakedown:   () => gameplayStore.update(state => ({ takedowns: state.takedowns + 1 })),
  triggerCrash:  () => gameplayStore.update(state => ({ crashFlash: state.crashFlash + 1 })),

  increaseZone: () => gameplayStore.update(state => {
    const zone  = state.zone + 1
    const known = state.speedLevels.some(level => level.zone === zone)
    // If the next zone does not exist yet, create it and the next few.
    const speedLevels = known
      ? state.speedLevels
      : [ ...state.speedLevels, ...Array.from({ length: SPEED_LEVEL_EXTENSION }, (_, i) => speedLevel(state.speedLevels.length + i + 1)) ]
    return { zone, speedLevels }
  }),
}
