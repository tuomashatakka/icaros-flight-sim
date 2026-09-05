import { DEFAULT_CONFIGS, SHIP_IDS } from 'Ȼship/registry'
import { defineStore } from './store'
import { DEFAULT_SHIP, SHIP_STORE_KEY, SHIP_STORE_VERSION, initialShipConfigs } from './defaults'
import type { ShipConfig, ShipId, ShipState } from './types'


const mergeSavedConfig = (shipId: ShipId, config: Partial<ShipConfig> | undefined): ShipConfig =>
  ({ ...DEFAULT_CONFIGS[shipId], ...config, shipId })

/** Layer any persisted edits over the factory defaults, backfilling ships added since. */
const mergeSavedConfigs = (configs?: Partial<Record<ShipId, Partial<ShipConfig>>>): Record<ShipId, ShipConfig> =>
  Object.fromEntries(SHIP_IDS.map(id => [ id, mergeSavedConfig(id, configs?.[id]) ])) as Record<ShipId, ShipConfig>

export const shipStore = defineStore<ShipState>(
  { shipConfigs: initialShipConfigs(), currentConfig: DEFAULT_CONFIGS[DEFAULT_SHIP] },
  {
    name:       SHIP_STORE_KEY,
    version:    SHIP_STORE_VERSION,
    partialize: state => ({ shipConfigs: state.shipConfigs, currentConfig: state.currentConfig }),
    migrate:    saved => {
      const shipConfigs = mergeSavedConfigs(saved.shipConfigs)
      const savedShip   = saved.currentConfig?.shipId
      const activeShip  = savedShip && SHIP_IDS.includes(savedShip) ? savedShip : DEFAULT_SHIP
      return { ...saved, shipConfigs, currentConfig: shipConfigs[activeShip] }
    },
  }
)

export const shipActions = {
  selectShip: (shipId: ShipId) => shipStore.update(state => ({ currentConfig: state.shipConfigs[shipId] })),

  updateConfig: (updates: Partial<ShipConfig>) => shipStore.update(state => {
    const next = { ...state.currentConfig, ...updates }
    return { currentConfig: next, shipConfigs: { ...state.shipConfigs, [next.shipId]: next }}
  }),

  setConfig: (config: ShipConfig) => shipStore.update(state =>
    ({ currentConfig: config, shipConfigs: { ...state.shipConfigs, [config.shipId]: config }})),

  /** Push the active ship's customisation onto every other hull (fleet livery). */
  applyToAllShips: () => shipStore.update(state => {
    // `shipId` is identity, not customisation — it must stay per-entry.
    const { shipId: _ignored, ...look } = state.currentConfig
    return {
      shipConfigs: Object.fromEntries(
        SHIP_IDS.map(id => [ id, { ...state.shipConfigs[id], ...look }])
      ) as Record<ShipId, ShipConfig>,
    }
  }),

  resetToDefault: () => shipStore.update(state => {
    const shipId = state.currentConfig.shipId
    const def    = DEFAULT_CONFIGS[shipId]
    return { currentConfig: def, shipConfigs: { ...state.shipConfigs, [shipId]: def }}
  }),
}
