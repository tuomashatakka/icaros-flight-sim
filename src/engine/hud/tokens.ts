import type { ShipTuning } from '../state'


export const HUD_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

export const HUD_COLORS = {
  cyan:    '#58f7ef',
  blue:    '#74a7ff',
  violet:  '#b892ff',
  magenta: '#ff78bd',
  amber:   '#ffd06a',
  white:   '#e5ffff',
  green:   '#7fffd1',
  red:     '#ff5470',
} as const

export const HUD_PANEL_PERIOD   = 0.075
export const HUD_OVERLAY_PERIOD = 1 / 30
export const HUD_REFERENCE_FOV  = 63

export type HudTuningSpec = {
  key:   keyof ShipTuning;
  label: string;
  min:   number;
  max:   number;
  step:  number;
}

export const HUD_TUNING_SPECS: readonly HudTuningSpec[] = [
  { key: 'hoverHeight', label: 'hover height', min: 0.2, max: 1.6, step: 0.05 },
  { key: 'suspensionStiffness', label: 'suspension', min: 5, max: 60, step: 1 },
  { key: 'thrust', label: 'thrust', min: 200, max: 2500, step: 50 },
  { key: 'sideGrip', label: 'side grip', min: 0.5, max: 6, step: 0.1 },
  { key: 'maxYawRate', label: 'yaw rate', min: 0.5, max: 5, step: 0.1 },
  { key: 'uprightStrength', label: 'upright', min: 1, max: 20, step: 0.5 },
  { key: 'maxBank', label: 'bank', min: 0, max: 1.2, step: 0.05 },
]
