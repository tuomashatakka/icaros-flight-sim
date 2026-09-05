/**
 * Orbital Ring — a banked station loop in the starfield. Opens with a FLAT
 * colinear front straight through the origin, so the ship lands on the deck
 * instead of dropping through a hole, then climbs into steeply banked turns.
 */

import { Vector3 } from 'three'

import { buildTrack, ribbonBoxColliders } from '../track-geometry'
import { sampleCurve } from './neon-canyon'

import type { TrackBundle } from './types'


const v = (x: number, y: number, z: number) => new Vector3(x, y, z)

export function orbitalRingTrack (): TrackBundle {
  const { geometry, vertices, curve } = buildTrack({
    points: [
      // Flat colinear front straight under the spawn.
      v(0, 0, 60), v(0, 0, 20), v(0, 0, -20), v(0, 0, -60),
      // Climb into the banked far turn.
      v(70, 10, -140), v(180, 18, -180), v(270, 12, -140),
      v(290, 4, -40), v(250, 12, 70), v(150, 18, 120),
      v(50, 10, 100), v(30, 3, 40),
    ],
    width:    24,
    segments: 14,
    closed:   true,
    banking:  0.5,
  })

  return {
    geometry,
    curve,
    spec: {
      id:         'orbital-ring',
      name:       'Orbital Ring',
      background: '#0a0f1e',
      fog:        [ '#0a0f1e', 200, 700 ],
      waypoints:  sampleCurve(curve, 10),
      width:      24,
      laps:       3,
      loop:       true,
      colliders:      ribbonBoxColliders(vertices, { stride: 1 }),
      colliderOffset: [ 0, -0.05, 0 ],
      bloom: { strength: 0.45, threshold: 0.86, radius: 0.5 },
    },
  }
}
