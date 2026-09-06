/**
 * Orbital Ring — a wide banked oval on a station deck, in the starfield.
 *
 * The fast one, and simple with it: two long straights joined by two constant
 * banked turns, which is the shape you can take flat out once you know it. What
 * it replaces climbed eighteen metres through 0.5 banking on a 24-metre road
 * and had no barriers, so the turns threw you off the station.
 *
 * The banking is real here — this is the track that has it — but it is applied
 * to radii wide enough to carry it, and the walls are the same height as
 * everywhere else.
 */

import { Vector3 } from 'three'

import { buildTrack, ribbonBoxColliders, ribbonWallColliders } from '../track-geometry'
import { sampleCurve } from './neon-canyon'

import type { TrackBundle } from './types'


const v = (x: number, y: number, z: number) => new Vector3(x, y, z)

const WIDTH       = 32
const WALL_HEIGHT = 6

export function orbitalRingTrack (): TrackBundle {
  const { geometry, vertices, curve } = buildTrack({
    points: [
      // Flat colinear front straight under the grid.
      v(0, 0, 90), v(0, 0, 30), v(0, 0, -30),
      // Constant-radius banked turn one.
      v(20, 3, -110), v(90, 5, -160), v(170, 3, -130), v(200, 0, -60),
      // Back straight.
      v(200, 0, 20),
      // Constant-radius banked turn two, mirroring the first.
      v(180, 3, 100), v(110, 5, 145), v(40, 3, 130), v(10, 0, 60),
    ],
    width:    WIDTH,
    segments: 16,
    closed:   true,
    banking:  0.3,
  })

  return {
    geometry,
    curve,
    vertices,
    spec: {
      id:             'orbital-ring',
      name:           'Orbital Ring',
      background:     '#050914',
      fog:            [ '#050914', 220, 760 ],
      waypoints:      sampleCurve(curve, 12),
      width:          WIDTH,
      laps:           3,
      loop:           true,
      colliders:      [
        ...ribbonBoxColliders(vertices, { stride: 1 }),
        ...ribbonWallColliders(vertices, { height: WALL_HEIGHT, stride: 1 }),
      ],
      colliderOffset: [ 0, -0.05, 0 ],
      bloom:          { strength: 0.4, threshold: 0.87, radius: 0.5 },
    },
  }
}
