import { HULL_SLIDERS } from './hull-shape'
import type { HullShape } from './hull-shape'
import type { ShipConfig, TexturePreset } from './registry'

/** A random-roll interval: `min` at roll 0, `max` at roll 1. Rolling stays in the caller — this is UI, not sim. */
export type Range = readonly [number, number]

type LookField = keyof Pick<ShipConfig, 'metalness' | 'roughness' | 'emissiveIntensity' | 'gloss' | 'patternAngle' | 'burnIntensity' | 'burnLength'>
type BuildField = keyof Pick<ShipConfig, 'platingDepth' | 'gunScale' | 'gunSpread'>

/** Ranges `randomLook()` rolls against, one per livery field it touches. */
export const RANDOM_LOOK_RANGES: Record<LookField, Range> = {
  metalness:         [ 0.2, 0.95 ],
  roughness:         [ 0.15, 0.85 ],
  emissiveIntensity: [ 0.3, 1 ],
  gloss:             [ 0.4, 1.6 ],
  patternAngle:      [ 0, Math.PI ],
  burnIntensity:     [ 0.6, 1.8 ],
  burnLength:        [ 0.7, 2.3 ],
}

/** Ranges `randomBuild()` rolls against for the non-geometry half of a build. */
export const RANDOM_BUILD_RANGES: Record<BuildField, Range> = {
  platingDepth: [ 0, 2 ],
  gunScale:     [ 0.6, 1.4 ],
  gunSpread:    [ 0.4, 1.3 ],
}

/**
 * Ranges for the fifteen geometry parameters, derived from the slider table
 * rather than restated here.
 *
 * A restated copy is how the old three-field version drifted: the sliders went
 * to 1.7 while the randomiser still stopped at 1.6, so "randomize build" could
 * not reach a silhouette a pilot could dial in by hand. `random` is deliberately
 * narrower than `[min, max]` — a roll at both extremes of all fifteen at once is
 * not a ship.
 */
export const RANDOM_HULL_RANGES: Record<keyof HullShape, Range> =
  HULL_SLIDERS.reduce((ranges, slider) => {
    ranges[slider.key] = slider.random
    return ranges
  }, {} as Record<keyof HullShape, Range>)

/** Texture presets `randomLook()` may pick — every preset, `plain` included. */
export const RANDOM_TEXTURE_PRESETS: readonly TexturePreset[] = [
  'plain', 'panels', 'carbon', 'hazard', 'city', 'gallery', 'racing', 'splinter', 'circuit',
]
