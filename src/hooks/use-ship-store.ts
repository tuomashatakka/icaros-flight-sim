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
        version: 2,
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
