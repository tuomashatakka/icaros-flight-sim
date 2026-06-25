"use client"

import { create } from 'zustand';
import { subscribeWithSelector, persist, createJSONStorage } from 'zustand/middleware';

export type TexturePreset = 'plain' | 'panels' | 'carbon' | 'hazard' | 'city' | 'gallery';
export type PaletteName = 'default' | 'colibri' | 'ion' | 'ember' | 'ink' | 'toxic';
export type ShipId = 'cb1' | 'icaras';

export interface ShipConfig {
  bodyColor: string;
  emissiveColor: string;
  metalness: number;
  roughness: number;
  emissiveIntensity: number;
  texturePreset: TexturePreset;
  textureRepeat: number;
  paletteName: PaletteName;
  shipId: ShipId;
}

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

const defaultCb1Config: ShipConfig = {
  bodyColor: '#ffffff',
  emissiveColor: '#000000',
  metalness: 0.5,
  roughness: 0.5,
  shipId: 'cb1',
  texturePreset: 'plain',
  textureRepeat: 1,
  emissiveIntensity: 0.0,
  paletteName: 'default',
};

const defaultIcarasConfig: ShipConfig = {
  bodyColor: '#4a90e2',
  emissiveColor: '#ff00ff',
  metalness: 0.3,
  roughness: 0.4,
  shipId: 'icaras',
  texturePreset: 'panels',
  textureRepeat: 2,
  emissiveIntensity: 0.5,
  paletteName: 'colibri',
};

/** Factory defaults, kept separate so "Reset" restores them even after edits. */
const DEFAULT_CONFIGS: Record<ShipId, ShipConfig> = {
  cb1: defaultCb1Config,
  icaras: defaultIcarasConfig,
};

export const useShipStore = create<ShipState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        shipConfigs: {
          cb1: defaultCb1Config,
          icaras: defaultIcarasConfig,
        },
        currentConfig: defaultCb1Config,

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
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({
          shipConfigs: state.shipConfigs,
          currentConfig: state.currentConfig,
        }),
      }
    )
  )
);
