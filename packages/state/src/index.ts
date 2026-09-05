/**
 * Client state: one import path.
 *
 * Types live in `./types`, initial values and constants in `./defaults`, and
 * each domain file holds its store plus the actions that write it. React reads
 * a store through `Δstate/react`, which is kept out of this barrel so the
 * engine never pulls React in.
 */

export * from './types'
export * from './defaults'
export { defineStore } from './store'
export type { ClientStore, PersistOptions, SelectOptions, Selector } from './store'
export { gameplayActions, gameplayStore } from './gameplay'
export { raceActions, raceStore, raceTimers, resetRaceTimers } from './race'
export { battleActions, battleStore } from './battle'
export { shipActions, shipStore } from './ship'
export { tuningActions, tuningStore } from './tuning'
export { cameraViewStore, setCameraView } from './camera-view'
export { hangarViewStore, toggleHangarView } from './hangar-view'
