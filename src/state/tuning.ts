import { defineStore } from './store'
import { DEFAULT_TUNING, LEGACY_DEFAULT_YAW_RATE, TUNING_STORE_KEY, TUNING_STORE_VERSION } from './defaults'
import type { ShipTuning, TuningState } from './types'

/**
 * Live physics tuning. Persisted so a tuning session survives a refresh;
 * `asSource()` in `@/lib/tuning` emits the block you paste back into
 * `vehicleConfig`.
 */
export const tuningStore = defineStore<TuningState>(
  { tuning: { ...DEFAULT_TUNING }, open: false },
  {
    name:       TUNING_STORE_KEY,
    version:    TUNING_STORE_VERSION,
    partialize: state => ({ tuning: state.tuning, open: state.open }),

    // Version 1 persisted the old yaw default. Move only that exact value to
    // the calmer default; deliberate custom yaw values survive.
    migrate: saved => saved.tuning?.maxYawRate === LEGACY_DEFAULT_YAW_RATE
      ? { ...saved, tuning: { ...saved.tuning, maxYawRate: DEFAULT_TUNING.maxYawRate }}
      : saved,

    // A saved value for a knob that has since been removed (or a missing one
    // for a knob just added) would otherwise reach the sim as `undefined` and
    // quietly produce NaN forces.
    merge: (saved, current) => ({
      ...current,
      open:   saved.open ?? current.open,
      tuning: { ...DEFAULT_TUNING, ...saved.tuning },
    }),
  }
)

export const tuningActions = {
  set: <K extends keyof ShipTuning>(key: K, value: ShipTuning[K]) =>
    tuningStore.update(state => ({ tuning: { ...state.tuning, [key]: value }})),
  reset:   () => tuningStore.set({ tuning: { ...DEFAULT_TUNING }}),
  setOpen: (open: boolean) => tuningStore.set({ open }),
}
