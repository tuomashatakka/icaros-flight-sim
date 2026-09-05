import type { ShipConfig, TexturePreset } from './registry'

/** A random-roll interval: `min` at roll 0, `max` at roll 1. Rolling stays in the caller — this is UI, not sim. */
export type Range = readonly [number, number]

type LookField = keyof Pick<ShipConfig, 'metalness' | 'roughness' | 'emissiveIntensity' | 'gloss' | 'patternAngle' | 'burnIntensity' | 'burnLength'>
type BuildField = keyof Pick<ShipConfig, 'bodyWidth' | 'bodyHeight' | 'bodyLength' | 'platingDepth' | 'gunScale' | 'gunSpread'>

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

/** Ranges `randomBuild()` rolls against, one per silhouette/hardpoint field it touches. */
export const RANDOM_BUILD_RANGES: Record<BuildField, Range> = {
  bodyWidth:    [ 0.7, 1.6 ],
  bodyHeight:   [ 0.7, 1.5 ],
  bodyLength:   [ 0.75, 1.6 ],
  platingDepth: [ 0, 2 ],
  gunScale:     [ 0.6, 1.4 ],
  gunSpread:    [ 0.4, 1.3 ],
}

/** Texture presets `randomLook()` may pick — every preset, `plain` included. */
export const RANDOM_TEXTURE_PRESETS: readonly TexturePreset[] = [
  'plain', 'panels', 'carbon', 'hazard', 'city', 'gallery', 'racing', 'splinter', 'circuit',
]
