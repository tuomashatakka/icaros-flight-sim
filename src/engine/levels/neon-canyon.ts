/**
 * Neon Canyon, drawn. The spline and its colliders are data in
 * `@crash-velocity/race`; the ribbon geometry rides along in the bundle so the
 * mesh and the collision come from ONE evaluation of the curve.
 */

import * as THREE from 'three'

import { guideRail, pointLight, roadMaterial } from './shared'

import type { SceneContext } from 'threejs-scene'
import type { TrackBundle } from '@crash-velocity/race'
import type { EnvironmentOverrides } from '../scenes/environment'


/**
 * How this track differs from `DEFAULT_ENVIRONMENT`.
 *
 * Sky colour, fog range and the fill tint are level identity; the key-to-fill
 * ratio is not. Every track used to add its own hemisphere light on top of the
 * base rig, which is what buried the ship's shadow — so a level states deltas
 * here and never adds an ambient light of its own. Point lights placed in the
 * build below are still fine: those are set dressing, not fill.
 */
export const neonCanyonEnvironment: EnvironmentOverrides = {
  background: '#1a0a14',
  fog:        [ '#1a0a14', 140, 620 ],
  hemi:       { sky: '#ff6a4d', ground: '#1a0a14', intensity: 1.28 },
}

export function buildNeonCanyon (ctx: SceneContext, bundle: TrackBundle): void {
  const { geometry, curve } = bundle
  if (!geometry || !curve)
    return

  const road         = new THREE.Mesh(geometry, roadMaterial('#3a1c24', 0.3, 0.6))
  road.position.y    = -0.05
  road.receiveShadow = true
  ctx.scene.add(road)

  ctx.scene.add(guideRail(curve.getSpacedPoints(420), '#ff2d6f', 0.7, 0.2))

  ctx.scene.add(pointLight('#ff5a7a', 60, 140, [ 0, 18, 10 ]))
  ctx.scene.add(pointLight('#ff3b5c', 150, 320, [ 150, 30, -90 ]))
  ctx.scene.add(pointLight('#ff8a3d', 150, 320, [ 190, 30, 20 ]))
  ctx.scene.add(pointLight('#ff2d6f', 130, 300, [ -130, 30, 70 ]))
}
