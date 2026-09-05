/**
 * The procedural sprint, drawn. The hand-walked ribbon — including the merge
 * bridges that `ribbonBoxColliders` cannot infer — is generated in
 * `@crash-velocity/race`; this only puts a material on it.
 */

import * as THREE from 'three'

import { pointLight, roadMaterial } from './shared'

import type { SceneContext } from 'threejs-scene'
import type { TrackBundle } from '@crash-velocity/race'


export function buildProcedural (ctx: SceneContext, bundle: TrackBundle): void {
  const { geometry } = bundle
  if (!geometry)
    return

  const road         = new THREE.Mesh(geometry, roadMaterial('#333333', 0.15, 0.85))
  road.position.y    = -0.05
  road.receiveShadow = true
  ctx.scene.add(road)

  // This level carried no lights of its own under R3F — it leaned entirely
  // on the Canvas ambient + directional + Sky + Environment. The engine's
  // base layer is deliberately dim, so it needs its own fill here.
  ctx.scene.add(new THREE.HemisphereLight('#8a9bff', '#171720', 0.8))
  ctx.scene.add(pointLight('#aab4ff', 120, 500, [ 0, 80, -200 ]))
  ctx.scene.add(pointLight('#c8b4ff', 90, 400, [ 400, 60, -800 ]))

  ctx.scene.fog = new THREE.Fog('#171720', 120, 900)
}
