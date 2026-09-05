import type { ShipTuning } from 'Ƨ'


/**
 * Display face: panel captions, headers and button labels — anything drawn
 * uppercase with tracking. Mono carries every numeral and body line, so digits
 * never jitter and columns of data stay aligned.
 */
export const HUD_FONT_DISPLAY = '600 1em "Segoe UI Semibold", Eurostile, "Bank Gothic", system-ui, sans-serif'
export const HUD_FONT_MONO    = 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, Monaco, Consolas, monospace'

/** @deprecated kept for the many call sites still spelling the mono face this way. */
export const HUD_FONT = HUD_FONT_MONO

/**
 * The instrument hues.
 *
 * Cool holo glass, one hue per station — a glance at the colour tells you which
 * instrument you are reading before you read a glyph of it. This is the ONLY
 * table with hex literals in it; a painter reaches for `HUD_THEME` below, and a
 * facet for `HUD_PANEL_ACCENTS`.
 */
export const HUD_HUES = {
  cyan:    '#58f7ef',
  blue:    '#74a7ff',
  violet:  '#b892ff',
  magenta: '#ff78bd',
  amber:   '#ffd06a',
  white:   '#e5ffff',
  green:   '#7fffd1',
  red:     '#ff5470',

  /** Bar gradient partners — the far end of a two-stop meter. */
  lime: '#d6f66c',
  teal: '#6ff0d4',
} as const

/**
 * The same hues lifted toward white, for body text and readouts.
 *
 * A data line drawn in its panel's own accent competes with the stroke around
 * it; drawn in plain white it stops belonging to the panel. These sit between.
 */
export const HUD_PALE = {
  cyan:    '#b9ffff',
  blue:    '#dfeaff',
  violet:  '#d9ccff',
  magenta: '#ffd8eb',
  amber:   '#ffe99f',
} as const

/**
 * The HUD palette, as one switchable block.
 *
 * Named by ROLE, not by hue, because the roles are what the painters mean and
 * the hues are what a retheme changes. `primary` is the cockpit's own light —
 * chrome, systems, the default accent. `accent` is the CONTRAST: gates,
 * targets, anything that is not your own systems. Red is alerts, enemies and
 * critical thresholds. Green means exactly one thing: locked / ready. Reaching
 * outside a lane (the accent for a menu button, red for a friendly) is the bug
 * this table exists to prevent — a painter should never need a hex literal,
 * because everything it could mean is already named here.
 */
export const HUD_THEME = {

  /** Primary holo — cockpit systems, chrome, default panel accent. */
  primary: HUD_HUES.cyan,
  bright:  HUD_PALE.cyan,
  pale:    HUD_HUES.white,

  /** The primary at low alpha: inactive strokes, empty segments, troughs. */
  dim:    'rgba(88, 247, 239, .34)',
  dimmer: 'rgba(88, 247, 239, .16)',

  /** Contrast accent: gates, targets, friendlies. Never the panel's own chrome. */
  accent: HUD_HUES.amber,

  /** Alerts, enemies, critical thresholds. */
  red: HUD_HUES.red,

  /** Locked / ready. Nothing else. */
  green: HUD_HUES.green,

  /** Ink and glass. */
  ink:      'rgba(4, 14, 22, .62)',
  inkSolid: 'rgba(3, 9, 15, .90)',
} as const

export type HudThemeColor = (typeof HUD_THEME)[keyof typeof HUD_THEME]

/**
 * One accent per facet, as the visor was authored.
 *
 * Keyed by `HudPanelKey` — spelled out here rather than imported, so the
 * palette stays a leaf module that no painter can cycle back into.
 */
export const HUD_PANEL_ACCENTS = {
  topLeft:      HUD_HUES.cyan,
  topCenter:    HUD_HUES.blue,
  topRight:     HUD_HUES.magenta,
  center:       HUD_HUES.white,
  bottomLeft:   HUD_HUES.cyan,
  bottomCenter: HUD_HUES.violet,
  bottomRight:  HUD_HUES.amber,
} as const

// --- glow -------------------------------------------------------------------
// Every glowing stroke is two passes: a wide, low-alpha pass under a thin,
// bright one. `shadowBlur` is a per-pixel convolution and slow at HUD cadence;
// two flat strokes cost almost nothing. See `chrome.ts#glowStroke/glowText`.
export const HUD_GLOW_WIDE_SCALE = 4.5
export const HUD_GLOW_WIDE_ALPHA = 0.22
export const HUD_GLOW_ALPHA      = 0.92

// --- chrome ------------------------------------------------------------------
/** Corner bracket tick length and inset, panel px. */
export const HUD_BRACKET_LEN   = 20
export const HUD_BRACKET_INSET = 8

/** Letter-spacing for tracked uppercase captions, panel px. */
export const HUD_CAPTION_TRACKING = 2.4
export const HUD_CAPTION_SIZE     = 12.5

/** Dot/hex texture behind data areas. Cached per panel size — never per frame. */
export const HUD_GRID_ALPHA = 0.04
export const HUD_GRID_CELL  = 16

// --- instruments --------------------------------------------------------------
export const HUD_SPEED_TAPE_MINOR_KMH = 10
export const HUD_SPEED_TAPE_MAJOR_KMH = 50
export const HUD_HEADING_TAPE_MINOR_DEG = 15
export const HUD_HEADING_TAPE_MAJOR_DEG = 45

/** Chunky ED-style segments with 1 px gaps, for throttle/boost/capacitor bars. */
export const HUD_BAR_SEGMENTS = 14
export const HUD_BAR_GAP      = 1.5

/** Boost reads in its panel's accent above this, red below it. */
export const HUD_BOOST_CRITICAL = 0.15

export const HUD_PANEL_HZ       = 20
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

/**
 * The continuous glass behind the seven facets.
 *
 * A shader tint, not a painted colour: it is additive over the world at a few
 * percent alpha, so it needs its own value rather than the primary — the
 * primary at that exposure washes the whole view in one hue, which is what
 * made the cockpit read as a colour filter instead of as glass.
 */
export const HUD_GLASS_TINT = '#53cfe0'

/**
 * Holographic material tints for scenery holograms (beacons, objective
 * markers, the visor glass). Kept apart from HUD_THEME because they are lit
 * by the shader, not painted, and read at a different exposure.
 */
export const HUD_HOLO = {
  cyan:    '#79f7ff',
  magenta: '#ff63b4',
  amber:   '#ffb347',
  violet:  '#be63ff',
  white:   '#dff6ff',
} as const
