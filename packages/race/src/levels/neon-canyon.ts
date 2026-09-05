/**
 * Neon Canyon — a winding, banked ravine. The spline opens with a FLAT,
 * colinear straight along -Z straddling the origin, so the ship lands squarely
 * on the road before the track banks and snakes out into the canyon.
 */

import { Vector3 } from 'three'

import { buildTrack, ribbonBoxColliders } from '../track-geometry'

import type { TrackBundle } from './types'
import type { Vec3Tuple } from '../track'


const v = (x: number, y: number, z: number) => new Vector3(x, y, z)

export function neonCanyonTrack (): TrackBundle {
  const { geometry, vertices, curve } = buildTrack({
    points: [
      // Flat colinear start (zero curvature -> zero bank) under the spawn.
      v(0, 0, 80), v(0, 0, 40), v(0, 0, 0), v(0, 0, -40),
      // Bank out into the canyon.
      v(50, 5, -110), v(140, 9, -130), v(200, 6, -70),
      v(205, 3, 20), v(150, 8, 95), v(60, 11, 140),
      v(-50, 7, 140), v(-150, 2, 80), v(-160, 0, -10),
      v(-90, 0, -50), v(-30, 0, -30),
    ],
    width:    26,
    segments: 16,
    closed:   true,
    banking:  0.4,
  })

  return {
    geometry,
    curve,
    spec: {
      id:             'neon-canyon',
      name:           'Neon Canyon',
      background:     '#1a0a14',
      fog:            [ '#1a0a14', 140, 620 ],
      waypoints:      sampleCurve(curve, 10),
      width:          26,
      laps:           3,
      loop:           true,
      colliders:      ribbonBoxColliders(vertices, { stride: 1 }),
      colliderOffset: [ 0, -0.05, 0 ],
      bloom:          { strength: 0.5, threshold: 0.85, radius: 0.5 },
    },
  }
}

/** Waypoints as tuples, not `Vector3`: a track goes over the wire on join. */
type CurveType = { getPointAt (t: number): Vector3 }

export function sampleCurve (curve: CurveType, count: number): Vec3Tuple[] {
  return Array.from({ length: count }, (_, i) => {
    const p = curve.getPointAt(i / count)
    return [ p.x, p.y, p.z ] as Vec3Tuple
  })
}
