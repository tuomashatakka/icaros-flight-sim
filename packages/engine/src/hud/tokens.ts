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
 * The HUD palette, as one switchable block.
 *
 * Warm amber is the primary holo colour — the cockpit's own light. Cyan is
 * reserved as the CONTRAST accent: targets, gates, friendlies — anything that
 * is not "your own systems". Red is alerts, enemies and anything critical.
 * Green means exactly one thing: locked / ready. Reaching for a colour outside
 * its lane (cyan for a menu button, red for a friendly) is the bug this table
 * exists to prevent — a painter should never need a hex literal, because
 * everything it could mean is already named here.
 */
export const HUD_THEME = {

  /** Primary holo — cockpit systems, chrome, default panel accent. */
  amber:       '#ff9d2e',
  amberBright: '#ffc46b',
  pale:        '#ffe3b8',
  dim:         'rgba(255, 157, 46, .28)',
  dimmer:      'rgba(255, 157, 46, .14)',

  /** Contrast accent: targets, gates, friendlies. Never the panel's own chrome. */
  cyan: '#5fe3ff',

  /** Alerts, enemies, critical thresholds. */
  red: '#ff4d5e',

  /** Locked / ready. Nothing else. */
  green: '#8dffb0',

  /** Ink and glass. */
  ink:      'rgba(18, 9, 3, .58)',
  inkSolid: 'rgba(15, 8, 3, .92)',
} as const

export type HudThemeColor = (typeof HUD_THEME)[keyof typeof HUD_THEME]

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

/** Boost reads amber above this, red below it. */
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
