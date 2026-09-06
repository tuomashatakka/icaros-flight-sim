/**
 * Neon Canyon, drawn. The spline and its colliders are data in
 * `@crash-velocity/race`; the ribbon geometry rides along in the bundle so the
 * mesh and the collision come from ONE evaluation of the curve.
 */

import * as THREE from 'three'

import { finaliseStaticScene, guideRail, pointLight, gatePosts, ribbonWalls, roadMaterial } from './shared'

import type { SceneContext } from 'threejs-scene'
import type { TrackBundle } from 'Λ'
import type { EnvironmentOverrides } from '../environment'


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
  background: '#12060f',
  fog:        [ '#12060f', 160, 640 ],
  hemi:       { sky: '#ff6a4d', ground: '#12060f', intensity: 0.44 },
}

export function buildNeonCanyon (ctx: SceneContext, bundle: TrackBundle): void {
  const root                          = new THREE.Group()
  const { geometry, curve, vertices } = bundle
  if (!geometry || !curve)
    return

  const road         = new THREE.Mesh(geometry, roadMaterial('#160a11', 0.2, 0.75))
  road.position.y    = -0.05
  road.receiveShadow = true
  root.add(road)

  // The barriers, from the same strip the colliders come from.
  if (vertices)
    root.add(ribbonWalls(vertices, { height: 6, face: '#1d0d16', cap: '#ff2d6f' }))

  root.add(gatePosts(bundle.spec.waypoints, bundle.spec.width / 2 + 1.2, '#ff2d6f'))
  root.add(guideRail(curve.getSpacedPoints(420), '#ff2d6f', 0.35, 0.2))

  root.add(pointLight('#ff5a7a', 24, 150, [ 0, 18, 10 ]))
  root.add(pointLight('#ff3b5c', 46, 300, [ 130, 30, -100 ]))
  root.add(pointLight('#ff8a3d', 46, 300, [ 190, 30, 20 ]))
  root.add(pointLight('#ff2d6f', 40, 280, [ -70, 30, 90 ]))

  finaliseStaticScene('neon canyon', root)
  ctx.scene.add(root)
}
