/**
 * A track the map forge just compiled, drawn.
 *
 * The four shipped tracks each get a hand-authored visual — their own palette,
 * their own set dressing, their own point lights. A draft has none of that and
 * must not need any: the forge hands over a `TrackBundle` and this puts a
 * readable surface on it out of the same pieces the shipped tracks are built
 * from, so a test drive shows you the road, the barriers and the gates you
 * authored rather than a grey ribbon in the dark.
 *
 * Its palette comes from the document's own environment, which the compiler has
 * already folded into the spec's `background` and `fog`.
 */

import * as THREE from 'three'

import { finaliseStaticScene, gatePosts, guideRail, pointLight, ribbonWalls, roadMaterial } from './shared'
import { buildProps } from './props'

import type { SceneContext } from 'threejs-scene'
import type { TrackBundle } from 'Λ'
import type { PropPlacement } from 'Ȼprops'
import type { EnvironmentOverrides } from '../environment'


/** The forge's own sky, taken from the spec the compiler produced. */
export function draftEnvironment (bundle: TrackBundle): EnvironmentOverrides {
  const [ colour, near, far ] = bundle.spec.fog
  return {
    background: bundle.spec.background,
    fog:        [ colour, near, far ],
    hemi:       { sky: '#8a9bff', ground: bundle.spec.background, intensity: 0.42 },
  }
}

export function buildDraft (ctx: SceneContext, bundle: TrackBundle, props: readonly PropPlacement[] = []): void {
  const root                          = new THREE.Group()
  const { geometry, curve, vertices } = bundle

  if (geometry) {
    const road         = new THREE.Mesh(geometry, roadMaterial('#1a1d2a', 0.25, 0.7))
    road.position.y    = -0.05
    road.receiveShadow = true
    root.add(road)
  }

  if (vertices)
    root.add(ribbonWalls(vertices, { height: 6, face: '#161a26', cap: '#58f7ef' }))

  if (curve)
    root.add(guideRail(curve.getSpacedPoints(420), '#58f7ef', 0.35, 0.2))

  root.add(gatePosts(bundle.spec.waypoints, bundle.spec.width / 2 + 1.2, '#ffd06a'))

  // Props ride alongside the bundle rather than on it: `TrackBundle` lives in
  // `Λ`, which sits below `Ȼ` in the DAG and cannot name a `PropPlacement`.
  if (props.length)
    root.add(buildProps(props))

  root.add(pointLight('#9fb6ff', 30, 260, [ 0, 40, 0 ]))

  finaliseStaticScene('forge draft', root)
  ctx.scene.add(root)
}
