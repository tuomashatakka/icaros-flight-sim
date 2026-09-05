import { defineStore } from './store'
import { INITIAL_HANGAR_VIEW } from './defaults'
import type { HangarViewState, HangarViewToggle } from './types'

/**
 * Hangar viewport toggles. Deliberately not persisted and not part of
 * `ShipConfig`: they describe how you are looking at the ship, not the ship.
 */
export const hangarViewStore = defineStore<HangarViewState>(INITIAL_HANGAR_VIEW)

export const toggleHangarView = (key: HangarViewToggle): void =>
  hangarViewStore.update(state => ({ [key]: !state[key] }))
