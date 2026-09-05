/**
 * The procedural sprint, drawn. The hand-walked ribbon — including the merge
 * bridges that `ribbonBoxColliders` cannot infer — is generated in
 * `@crash-velocity/race`; this only puts a material on it.
 */

import * as THREE from 'three'

import { finaliseStaticScene, pointLight, roadMaterial } from './shared'

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
  background: '#171720',

  // A ~3000-unit sprint: it needs far more range than the fixed decks.
  fog:  [ '#171720', 120, 900 ],
  hemi: { sky: '#8a9bff', ground: '#171720', intensity: 1.18 },
}

export function buildProcedural (ctx: SceneContext, bundle: TrackBundle): void {
  const root         = new THREE.Group()
  const { geometry } = bundle
  if (!geometry)
    return

  const road         = new THREE.Mesh(geometry, roadMaterial('#333333', 0.15, 0.85))
  road.position.y    = -0.05
  road.receiveShadow = true
  root.add(road)

  root.add(pointLight('#aab4ff', 120, 500, [ 0, 80, -200 ]))
  root.add(pointLight('#c8b4ff', 90, 400, [ 400, 60, -800 ]))

  finaliseStaticScene('procedural sprint', root)
  ctx.scene.add(root)
}
