/**
 * The procedural sprint, drawn. The hand-walked ribbon is generated in
 * `@crash-velocity/race`; this puts a material on it and stands its barriers up.
 */

import * as THREE from 'three'

import { finaliseStaticScene, gatePosts, pointLight, ribbonWalls, roadMaterial } from './shared'

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
export const proceduralEnvironment: EnvironmentOverrides = {
  background: '#0d0d16',

  // A ~3500-unit sprint: it needs far more range than the fixed decks.
  fog:  [ '#0d0d16', 140, 950 ],
  hemi: { sky: '#8a9bff', ground: '#0d0d16', intensity: 0.42 },
}

export function buildProcedural (ctx: SceneContext, bundle: TrackBundle): void {
  const root                   = new THREE.Group()
  const { geometry, vertices } = bundle
  if (!geometry)
    return

  const road         = new THREE.Mesh(geometry, roadMaterial('#23232e', 0.15, 0.85))
  road.position.y    = -0.05
  road.receiveShadow = true
  root.add(road)

  if (vertices)
    root.add(ribbonWalls(vertices, { height: 6, face: '#191922', cap: '#8a9bff' }))

  root.add(gatePosts(bundle.spec.waypoints, bundle.spec.width / 2 + 1.2, '#8a9bff'))

  root.add(pointLight('#aab4ff', 40, 520, [ 0, 80, -200 ]))
  root.add(pointLight('#c8b4ff', 34, 420, [ 400, 60, -800 ]))

  finaliseStaticScene('procedural sprint', root)
  ctx.scene.add(root)
}
