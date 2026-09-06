/**
 * Neon Canyon — a wide, walled circuit with two sweepers and a chicane.
 *
 * Deliberately simple. What was here before was a fifteen-point spline through
 * eleven metres of elevation with 0.4 banking and a 26-metre road, and it was
 * not raceable for two separate reasons: it had no barriers at all, so the
 * first corner you overshot dropped you into the void with nothing to do but
 * reset, and the banking rolled hard enough on the tight radii that the deck
 * fought the hover rig through every turn.
 *
 * So: one plane of elevation, gentle banking, a road half again as wide, and
 * walls down both edges built from the same vertex strip as the deck.
 */

import { Vector3 } from 'three'

import { buildTrack, ribbonBoxColliders, ribbonWallColliders } from '../track-geometry'

import type { TrackBundle } from './types'
import type { Vec3Tuple } from '../track'


const v = (x: number, y: number, z: number) => new Vector3(x, y, z)

/** Full road width. Wide enough that a corner missed is a corner survived. */
const WIDTH = 34

/** Barrier height. A hovercraft rides up a short wall and straight over it. */
const WALL_HEIGHT = 6

export function neonCanyonTrack (): TrackBundle {
  const { geometry, vertices, curve } = buildTrack({
    points: [
      // Flat colinear start straddling the origin — zero curvature, zero bank,
      // so the grid lands square on the road.
      v(0, 0, 90), v(0, 0, 40), v(0, 0, -10),
      // Long right-hand sweeper out to the far wall.
      v(30, 0, -80), v(110, 0, -120), v(180, 0, -90),
      // Back straight.
      v(205, 0, -10), v(195, 0, 70),
      // Chicane: two short, opposite kinks rather than one hairpin.
      v(140, 0, 110), v(90, 0, 95), v(40, 0, 120),
      // Home sweeper.
      v(-40, 0, 120), v(-95, 0, 70), v(-90, 0, 10), v(-40, 0, 40),
    ],
    width:    WIDTH,
    segments: 14,
    closed:   true,
    banking:  0.16,
  })

  return {
    geometry,
    curve,
    vertices,
    spec: {
      id:         'neon-canyon',
      name:       'Neon Canyon',
      background: '#12060f',
      fog:        [ '#12060f', 160, 640 ],
      waypoints:  sampleCurve(curve, 12),
      width:      WIDTH,
      laps:       3,
      loop:       true,
      colliders:  [
        ...ribbonBoxColliders(vertices, { stride: 1 }),
        ...ribbonWallColliders(vertices, { height: WALL_HEIGHT, stride: 1 }),
      ],
      colliderOffset: [ 0, -0.05, 0 ],
      bloom:          { strength: 0.42, threshold: 0.86, radius: 0.5 },
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
