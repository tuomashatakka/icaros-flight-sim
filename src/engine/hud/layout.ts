import type { HudPanelKey } from './types'


export type HudVisorPoint = readonly [number, number, number]
export type HudVisorCorners = readonly [HudVisorPoint, HudVisorPoint, HudVisorPoint, HudVisorPoint]

export type HudVisorFacet = {
  key: HudPanelKey;

  /** bottom-left, bottom-right, top-left, top-right */
  corners: HudVisorCorners;
  trace?:  HudPanelTrace;
}

export type HudPanelUv = readonly [number, number]

export type HudPanelTrace = {
  variant: 'open' | 'screen';

  /** Counter-clockwise UV silhouette, with the origin at bottom-left. */
  contour: readonly HudPanelUv[];

  /** Open canopy strokes, each stored in bottom-left UV coordinates. */
  frame?: readonly (readonly HudPanelUv[])[];

  /** Safe content rectangle in top-left canvas coordinates, normalised 0..1. */
  content: Readonly<{ x: number; y: number; width: number; height: number }>;
}

export const HUD_VISOR_BOUNDS = {
  innerX:       1.43,
  outerX:       4.35,
  innerY:       1.36,
  outerY:       2.72,
  rimDepth:     -5.4,
  centerDepth:  -6.35,
  sideLift:     1.25,
  verticalDrop: 0.44,
} as const

export function hudVisorPoint (x: number, y: number): HudVisorPoint {
  const {
    innerX,
    outerX,
    innerY,
    outerY,
    rimDepth,
    centerDepth,
    sideLift,
    verticalDrop,
  }                  = HUD_VISOR_BOUNDS
  const sideFold     = Math.max(0, (Math.abs(x) - innerX) / (outerX - innerX))
  const verticalFold = Math.max(0, (Math.abs(y) - innerY) / (outerY - innerY))
  const centerBow    = Math.max(0, 1 - Math.abs(x) / innerX) *
    Math.max(0, 1 - Math.abs(y) / innerY)
  const recess = rimDepth - centerDepth

  return [ x, y, rimDepth + sideFold * sideLift - verticalFold * verticalDrop - centerBow * recess ]
}

function visorCorners (
  left: number,
  right: number,
  bottom: number,
  top: number
): HudVisorCorners {
  return [
    hudVisorPoint(left, bottom),
    hudVisorPoint(right, bottom),
    hudVisorPoint(left, top),
    hudVisorPoint(right, top),
  ]
}

function facet (key: HudPanelKey, left: number, right: number, bottom: number, top: number): HudVisorFacet {
  return { key, corners: visorCorners(left, right, bottom, top), trace: HUD_PANEL_TRACES[key] }
}

const { innerX, outerX, innerY, outerY } = HUD_VISOR_BOUNDS

/**
 * Normalised vector traces of the six primary outer displays in the supplied
 * cockpit reference. The live panel canvases are clipped to these paths; the
 * source bitmap is never shipped or sampled at runtime.
 */
export const HUD_PANEL_TRACES: Partial<Record<HudPanelKey, HudPanelTrace>> = {
  topLeft: {
    variant: 'open',
    contour: [[ 0.02, 0.02 ], [ 0.96, 0.02 ], [ 0.98, 0.82 ], [ 0.72, 0.96 ], [ 0.12, 0.98 ], [ 0, 0.8 ]],
    frame:   [
      [[ 0.04, 0.8 ], [ 0.12, 0.96 ], [ 0.72, 0.88 ], [ 0.92, 0.68 ], [ 0.9, 0.22 ]],
      [[ 0.14, 0.12 ], [ 0.14, 0.46 ]],
    ],
    content: { x: 0.08, y: 0.08, width: 0.82, height: 0.8 },
  },
  topCenter: {
    variant: 'open',
    contour: [[ 0.04, 0.08 ], [ 0.96, 0.08 ], [ 0.88, 0.92 ], [ 0.12, 0.92 ]],
    frame:   [
      [[ 0.06, 0.76 ], [ 0.3, 0.71 ]],
      [[ 0.38, 0.7 ], [ 0.62, 0.7 ]],
      [[ 0.7, 0.71 ], [ 0.94, 0.76 ]],
    ],
    content: { x: 0.08, y: 0.06, width: 0.84, height: 0.82 },
  },
  topRight: {
    variant: 'open',
    contour: [[ 0.04, 0.02 ], [ 0.98, 0.02 ], [ 1, 0.8 ], [ 0.88, 0.98 ], [ 0.28, 0.96 ], [ 0.02, 0.82 ]],
    frame:   [
      [[ 0.1, 0.22 ], [ 0.08, 0.68 ], [ 0.28, 0.88 ], [ 0.88, 0.96 ], [ 0.96, 0.8 ]],
      [[ 0.86, 0.12 ], [ 0.86, 0.46 ]],
    ],
    content: { x: 0.1, y: 0.08, width: 0.82, height: 0.8 },
  },
  bottomLeft: {
    variant: 'screen',
    contour: [[ 0.02, 0 ], [ 1, 0.14 ], [ 0.93, 1 ], [ 0, 0.88 ]],
    content: { x: 0.07, y: 0.08, width: 0.84, height: 0.8 },
  },
  bottomCenter: {
    variant: 'screen',
    contour: [[ 0.02, 0.04 ], [ 0.98, 0 ], [ 0.92, 0.96 ], [ 0.08, 1 ]],
    content: { x: 0.08, y: 0.08, width: 0.84, height: 0.8 },
  },
  bottomRight: {
    variant: 'screen',
    contour: [[ 0.02, 0 ], [ 0.98, 0.04 ], [ 0.92, 1 ], [ 0.08, 0.96 ]],
    content: { x: 0.08, y: 0.08, width: 0.84, height: 0.8 },
  },
}

/**
 * Seven readouts float over one recessed, inward-folded visor.
 *
 * The reference keeps the sightline open: side tapes sit below the heading
 * strip, both utility screens cluster left, and the systems screen stays right.
 * Their independent bounds preserve those gaps while the sampled glass behind
 * them remains one continuous surface.
 */
export const HUD_VISOR_FACETS: readonly HudVisorFacet[] = [
  facet('topLeft', -3.4, -1.5, -0.25, 1.25),
  facet('topCenter', -1.35, 1.35, 0.65, 1.85),
  facet('topRight', 1.5, 3.4, -0.25, 1.25),
  facet('center', -innerX, innerX, -innerY, innerY),
  facet('bottomLeft', -4.25, -2.55, -2.55, -1.25),
  facet('bottomCenter', -2.5, -0.4, -2.6, -1.25),
  facet('bottomRight', 1.8, 4.4, -2.6, -1.25),
]

/** Nine cells behind the seven readouts make the folded visor one glass sheet. */
export const HUD_VISOR_SURFACE: readonly HudVisorCorners[] = [
  visorCorners(-outerX, -innerX, innerY, outerY),
  visorCorners(-innerX, innerX, innerY, outerY),
  visorCorners(innerX, outerX, innerY, outerY),
  visorCorners(-outerX, -innerX, -innerY, innerY),
  visorCorners(-innerX, innerX, -innerY, innerY),
  visorCorners(innerX, outerX, -innerY, innerY),
  visorCorners(-outerX, -innerX, -outerY, -innerY),
  visorCorners(-innerX, innerX, -outerY, -innerY),
  visorCorners(innerX, outerX, -outerY, -innerY),
]

// perf: closed seven-facet config; the sampled geometry is authored once during HUD build.
