import { defineStore } from './store'
import { DEFAULT_SETTINGS, SETTINGS_LIMITS, SETTINGS_STORE_KEY, SETTINGS_STORE_VERSION } from './defaults'
import type { SettingsState } from './types'


type LimitKey = keyof typeof SETTINGS_LIMITS

const clampSetting = (key: LimitKey, value: unknown): number => {
  const { min, max } = SETTINGS_LIMITS[key]
  const number       = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_SETTINGS[key]
  return Math.max(min, Math.min(max, number))
}

/**
 * The player's settings: graphics, camera and controls.
 *
 * Persisted, and read by the engine through `store.get()`/`select` — the
 * settings page is a route of its own, and a scene mounted after it picks the
 * values up on build, while anything that can change live (resolution, the
 * post budget, mouse capture) is also applied on change.
 */
export const settingsStore = defineStore<SettingsState>(
  { ...DEFAULT_SETTINGS },
  {
    name:       SETTINGS_STORE_KEY,
    version:    SETTINGS_STORE_VERSION,
    partialize: state => state,

    // A save written before a key existed must not reach the renderer as
    // `undefined`, and a hand-edited one must not reach it out of range.
    merge: (saved, current) => {
      const merged = { ...current, ...saved }
      for (const key of Object.keys(SETTINGS_LIMITS) as LimitKey[])
        merged[key] = clampSetting(key, merged[key])
      return merged
    },
  }
)

export const settingsActions = {
  set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) =>
    settingsStore.update(state => state[key] === value ? state : { [key]: value } as Partial<SettingsState>),
  reset: () => settingsStore.set({ ...DEFAULT_SETTINGS }),
}
