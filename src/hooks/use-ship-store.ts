"use client"

import { create } from 'zustand';
import { subscribeWithSelector, persist, createJSONStorage } from 'zustand/middleware';
import {
  DEFAULT_CONFIGS,
  SHIP_IDS,
  type ShipConfig,
  type ShipId,
} from '@/lib/ship/registry';

// Re-exported so consumers that used to pull these from the store keep working.
export type { ShipConfig, ShipId, TexturePreset, PaletteName } from '@/lib/ship/registry';

interface ShipState {
  // Per-ship saved configurations.
  shipConfigs: Record<ShipId, ShipConfig>;
  // The active config (mirrors shipConfigs[currentConfig.shipId]).
  currentConfig: ShipConfig;
  selectShip: (shipId: ShipId) => void;
  updateConfig: (updates: Partial<ShipConfig>) => void;
  setConfig: (config: ShipConfig) => void;
  resetToDefault: () => void;
  /** Push the active ship's customisation onto every other hull (fleet livery). */
  applyToAllShips: () => void;
}

type PersistedShipState = Pick<ShipState, 'shipConfigs' | 'currentConfig'>;

const DEFAULT_SHIP: ShipId = 'icaras';

/** Fresh factory map for every registered ship. */
function initialShipConfigs(): Record<ShipId, ShipConfig> {
  return Object.fromEntries(SHIP_IDS.map((id) => [id, DEFAULT_CONFIGS[id]])) as Record<
    ShipId,
    ShipConfig
  >;
}

function mergeSavedConfig(shipId: ShipId, config: Partial<ShipConfig> | undefined): ShipConfig {
  return { ...DEFAULT_CONFIGS[shipId], ...config, shipId };
}

/** Layer any persisted edits over the factory defaults, backfilling ships added since. */
function mergeSavedConfigs(
  configs?: Partial<Record<ShipId, Partial<ShipConfig>>>
): Record<ShipId, ShipConfig> {
  return Object.fromEntries(
    SHIP_IDS.map((id) => [id, mergeSavedConfig(id, configs?.[id])])
  ) as Record<ShipId, ShipConfig>;
}

export const useShipStore = create<ShipState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        shipConfigs: initialShipConfigs(),
        currentConfig: DEFAULT_CONFIGS[DEFAULT_SHIP],

        selectShip: (shipId) => {
          set({ currentConfig: get().shipConfigs[shipId] });
        },

        updateConfig: (updates) => {
          set((state) => {
            const next = { ...state.currentConfig, ...updates };
            return {
              currentConfig: next,
              shipConfigs: { ...state.shipConfigs, [next.shipId]: next },
            };
          });
        },

        setConfig: (config) => {
          set((state) => ({
            currentConfig: config,
            shipConfigs: { ...state.shipConfigs, [config.shipId]: config },
          }));
        },

        applyToAllShips: () => {
          set((state) => {
            // `shipId` is identity, not customisation — it must stay per-entry.
            const { shipId: _ignored, ...look } = state.currentConfig;
            return {
              shipConfigs: Object.fromEntries(
                SHIP_IDS.map((id) => [id, { ...state.shipConfigs[id], ...look }])
              ) as Record<ShipId, ShipConfig>,
            };
          });
        },

        resetToDefault: () => {
          const shipId = get().currentConfig.shipId;
          const def = DEFAULT_CONFIGS[shipId];
          set((state) => ({
            currentConfig: def,
            shipConfigs: { ...state.shipConfigs, [shipId]: def },
          }));
        },
      }),
      {
        name: 'ship-config',
        // v2: registry-driven — backfills the 7 WipEout ships onto v1 saves.
        // v3: the WipEout ships gained real factory defaults (WIPEOUT_LOOK) now that the
        //     sliders actually drive them; v2 saves hold BASE_CONFIG-derived values.
        // v4: ships gained afterburner tuning (burnColor/burnIntensity/burnLength/
        //     nozzleSpread); the bump re-runs migrate(), which layers saves over the
        //     new defaults so existing edits survive but the plume fields appear.
        version: 4,
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({
          shipConfigs: state.shipConfigs,
          currentConfig: state.currentConfig,
        }),
        migrate: (persistedState) => {
          const persisted = persistedState as Partial<PersistedShipState> | undefined;
          const shipConfigs = mergeSavedConfigs(persisted?.shipConfigs);
          const savedShip = persisted?.currentConfig?.shipId as ShipId | undefined;
          const activeShip = savedShip && SHIP_IDS.includes(savedShip) ? savedShip : DEFAULT_SHIP;
          return {
            ...persisted,
            shipConfigs,
            currentConfig: shipConfigs[activeShip],
          };
        },
      }
    )
  )
);
