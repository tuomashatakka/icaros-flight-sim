import type { HudPanelKey } from './types'


export type HudVisorPoint = readonly [number, number, number]
export type HudVisorCorners = readonly [HudVisorPoint, HudVisorPoint, HudVisorPoint, HudVisorPoint]

export type HudVisorFacet = {
  key: HudPanelKey;

  /** bottom-left, bottom-right, top-left, top-right */
  corners: HudVisorCorners;
}

export const HUD_VISOR_BOUNDS = {
  innerX:       1.43,
  outerX:       4.35,
  innerY:       1.36,
  outerY:       2.72,
  centerDepth:  -6.2,
  sideLift:     0.95,
  verticalLift: 0.68,
} as const

function visorPoint (x: number, y: number): HudVisorPoint {
  const { innerX, outerX, innerY, outerY, centerDepth, sideLift, verticalLift } = HUD_VISOR_BOUNDS
  const sideFold                                                                = Math.max(0, (Math.abs(x) - innerX) / (outerX - innerX))
  const verticalFold                                                            = Math.max(0, (Math.abs(y) - innerY) / (outerY - innerY))
  return [ x, y, centerDepth + sideFold * sideLift + verticalFold * verticalLift ]
}

function visorCorners (
  left: number,
  right: number,
  bottom: number,
  top: number
): HudVisorCorners {
  return [
    visorPoint(left, bottom),
    visorPoint(right, bottom),
    visorPoint(left, top),
    visorPoint(right, top),
  ]
}

function facet (key: HudPanelKey, left: number, right: number, bottom: number, top: number): HudVisorFacet {
  return { key, corners: visorCorners(left, right, bottom, top) }
}

const { innerX, outerX, innerY, outerY } = HUD_VISOR_BOUNDS

/**
 * Seven display regions cut from one inward-folded visor.
 *
 * Every neighbour repeats the exact same boundary points: the top row faces
 * down toward the pilot, the bottom row faces up, and both flow into the flat
 * targeting pane without world-space gaps.
 */
export const HUD_VISOR_FACETS: readonly HudVisorFacet[] = [
  facet('topLeft', -outerX, -innerX, innerY, outerY),
  facet('topCenter', -innerX, innerX, innerY, outerY),
  facet('topRight', innerX, outerX, innerY, outerY),
  facet('center', -innerX, innerX, -innerY, innerY),
  facet('bottomLeft', -outerX, -innerX, -outerY, -innerY),
  facet('bottomCenter', -innerX, innerX, -outerY, -innerY),
  facet('bottomRight', innerX, outerX, -outerY, -innerY),
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

// perf: closed seven-facet config; geometry is authored once during HUD build.
