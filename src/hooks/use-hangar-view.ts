'use client'

import { create } from 'zustand'

/**
 * Hangar viewport toggles.
 *
 * Deliberately NOT persisted and deliberately not part of `ShipConfig`: these
 * describe how you are looking at the ship right now, not anything about the
 * ship. Keeping them out of the ship store also keeps that store's `subscribe`
 * from firing a livery re-apply every time someone flips the wireframe on.
 */
export interface HangarViewState {
  autoOrbit:  boolean;
  wireframe:  boolean;
  flightTilt: boolean;
  engines:    boolean;
  toggle:     (key: HangarViewToggle) => void;
}

export type HangarViewToggle = 'autoOrbit' | 'wireframe' | 'flightTilt' | 'engines'

export const useHangarView = create<HangarViewState>()(set => ({
  autoOrbit:  true,
  wireframe:  false,
  flightTilt: true,
  engines:    true,
  toggle:     key => set(state => ({ [key]: !state[key] }) as Pick<HangarViewState, typeof key>),
}))
