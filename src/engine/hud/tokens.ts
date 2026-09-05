import type { ShipTuning } from '../state'


export const HUD_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

/**
 * The HUD palette. Everything drawn on a facet, the overlay or a touch control
 * comes from here.
 *
 * The `pale*` tints and the two accents below are not new colours — they were
 * a dozen one-off hex literals scattered through `facets.ts` and `panel.ts`,
 * each a near-duplicate of a token above it. A palette only holds a design
 * together if the drawing code has no reason to reach past it.
 */
export const HUD_COLORS = {
  cyan:    '#58f7ef',
  blue:    '#74a7ff',
  violet:  '#b892ff',
  magenta: '#ff78bd',
  amber:   '#ffd06a',
  white:   '#e5ffff',
  green:   '#7fffd1',
  red:     '#ff5470',

  // Readout tints: the same hues lifted toward white so body text stays legible
  // against the glass without competing with an accent stroke.
  paleCyan:    '#b9ffff',
  paleBlue:    '#dfeaff',
  paleViolet:  '#d9ccff',
  paleMagenta: '#ffd8eb',
  paleAmber:   '#ffe99f',

  // Bar gradient partners.
  lime: '#d6f66c',
  teal: '#6ff0d4',
} as const

/** Ink and glass, as rgba strings. The chrome every panel and control shares. */
export const HUD_SURFACES = {

  /** Panel and control fill. */
  ink: 'rgba(4, 14, 22, .62)',

  /** Deeper fill, for anything that must stay readable over bright geometry. */
  inkSolid: 'rgba(3, 9, 15, .90)',

  /** Inactive stroke. */
  edge: 'rgba(88, 247, 239, .34)',

  /** Inner rule, one step in from the edge. */
  edgeDim: 'rgba(88, 247, 239, .16)',

  /** Bar troughs and disabled tracks. */
  track: 'rgba(126, 168, 190, .16)',
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
