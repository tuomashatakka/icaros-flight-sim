'use client'

import { create } from 'zustand'
import { subscribeWithSelector, persist, createJSONStorage } from 'zustand/middleware'
import { DEFAULT_TUNING } from '@/engine/state'
import type { ShipTuning } from '@/engine/state'


export { asSource, isDefaultTuning } from '@/lib/tuning'

/**
 * Live physics tuning — the replacement for Leva.
 *
 * Leva owned this state internally, which meant the numbers you dialled in
 * evaporated on reload and could only leave the browser by being read off the
 * screen and retyped. Holding them in a persisted store instead makes a tuning
 * session survive a refresh, and `asSource()` (in `@/lib/tuning`, re-exported
 * above) closes the loop by emitting the block you paste back into
 * `vehicleConfig`.
 */
export interface TuningState {
  tuning: ShipTuning;

  /** Panel open/closed. UI state, but persisted so it stays how you left it. */
  open:    boolean;
  set:     <K extends keyof ShipTuning>(key: K, value: ShipTuning[K]) => void;
  reset:   () => void;
  setOpen: (open: boolean) => void;
}

export const useTuningStore = create<TuningState>()(
  subscribeWithSelector(
    persist(
      set => ({
        tuning:  { ...DEFAULT_TUNING },
        open:    false,
        set:     (key, value) => set(state => ({ tuning: { ...state.tuning, [key]: value }})),
        reset:   () => set({ tuning: { ...DEFAULT_TUNING }}),
        setOpen: open => set({ open }),
      }),
      {
        name:       'ship-tuning',
        version:    1,
        storage:    createJSONStorage(() => localStorage),
        partialize: state => ({ tuning: state.tuning, open: state.open }),
        // A saved value for a knob that has since been removed (or a missing one
        // for a knob just added) would otherwise reach the sim as `undefined`
        // and quietly produce NaN forces.
        merge:      (persisted, current) => {
          const saved = persisted as Partial<Pick<TuningState, 'tuning' | 'open'>> | undefined
          return {
            ...current,
            open:   saved?.open ?? current.open,
            tuning: { ...DEFAULT_TUNING, ...saved?.tuning },
          }
        },
      }
    )
  )
)
