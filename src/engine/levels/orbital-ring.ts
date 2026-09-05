/**
 * Orbital Ring, drawn. Same split as Neon Canyon: the curve is evaluated once,
 * in the race package, and both the collision and this mesh come from it.
 */

import * as THREE from 'three'

import { guideRail, pointLight, roadMaterial, starfield } from './shared'

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
export const orbitalRingEnvironment: EnvironmentOverrides = {
  background: '#0a0f1e',
  fog:        [ '#0a0f1e', 200, 700 ],
  hemi:       { sky: '#3b82f6', ground: '#0a0f1e' },
}

export function buildOrbitalRing (ctx: SceneContext, bundle: TrackBundle): void {
  const { geometry, curve } = bundle
  if (!geometry || !curve)
    return

  const road         = new THREE.Mesh(geometry, roadMaterial('#1a3040', 0.5, 0.4))
  road.position.y    = -0.05
  road.receiveShadow = true
  ctx.scene.add(road)

  ctx.scene.add(guideRail(curve.getSpacedPoints(460), '#22d3ee', 0.6, 0.2))

  // Starfield backdrop + the planet far below.
  ctx.scene.add(starfield(ctx.rng))

  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(220, 48, 48),
    new THREE.MeshStandardMaterial({
      color:             '#13315c',
      emissive:          '#0a1a3a',
      emissiveIntensity: 0.5,
      roughness:         1,
      metalness:         0,
    })
  )
  planet.position.set(0, -320, -40)
  ctx.scene.add(planet)

  ctx.scene.add(new THREE.HemisphereLight('#3b82f6', '#0a0f1e', 0.9))
  ctx.scene.add(pointLight('#67e8f9', 70, 160, [ 0, 20, 10 ]))
  ctx.scene.add(pointLight('#22d3ee', 260, 460, [ 180, 50, -150 ]))
  ctx.scene.add(pointLight('#818cf8', 200, 420, [ 250, 40, 60 ]))

  ctx.scene.fog = new THREE.Fog('#0a0f1e', 200, 700)
}
