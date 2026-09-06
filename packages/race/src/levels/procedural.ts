/**
 * The procedural sprint — one walked ribbon, four turns, one jump, no branch.
 *
 * It used to fork into a risky shortcut and hand-stitch the merge back together
 * out of two non-adjacent rings, with two bridge colliders written by hand to
 * paper over the hole that left in the drivable surface. That is a lot of
 * machinery for a track that also had no barriers anywhere on it, so overshoot
 * anything and the run was over. One route, walls down both edges, and a road
 * wide enough to race on.
 *
 * The jump survives: it is the one place the ribbon is deliberately
 * discontinuous, and both the wall builder and the deck builder skip a segment
 * longer than `maxLen`, so the gap stays a gap in the collision as well as in
 * the mesh.
 */

import * as THREE from 'three'

import { ribbonBoxColliders, ribbonWallColliders } from '../track-geometry'

import type { TrackBundle } from './types'
import type { Vec3Tuple } from '../track'


/** Full road width, and the barrier that keeps you on it. */
const WIDTH       = 28
const WALL_HEIGHT = 6

/** How far the walk advances per emitted ring. */
const SEGMENT = 20

type Walk = {
  addSegment (length: number, curve: number, ramp: number): void;
  addJump (length: number, height: number): void;
  readonly vertices: number[];
  readonly indices:  number[];
  readonly centre:   THREE.Vector3[];
}

/**
 * A ribbon laid down one ring at a time, by heading rather than by spline.
 *
 * Kept because a sprint reads better authored as "four hundred metres, quarter
 * turn left, climbing" than as a list of control points whose Catmull-Rom
 * tension decides what the corner actually is.
 */
function createWalk (start: THREE.Vector3, heading: THREE.Vector3): Walk {
  const vertices: number[]       = []
  const indices: number[]        = []
  const centre: THREE.Vector3[]  = []
  const position                 = start.clone()
  const direction                = heading.clone().normalize()
  const side                     = new THREE.Vector3()
  const up                       = new THREE.Vector3(0, 1, 0)
  let previous                   = -1

  const addSegment = (length: number, curve: number, ramp: number) => {
    const steps = Math.max(1, Math.floor(length / SEGMENT))
    for (let i = 0; i < steps; i++) {
      centre.push(position.clone())
      side.crossVectors(direction, up).normalize()

      const left  = position.clone().addScaledVector(side, WIDTH / 2)
      const right = position.clone().addScaledVector(side, -WIDTH / 2)
      vertices.push(left.x, left.y, left.z, right.x, right.y, right.z)

      if (previous >= 0) {
        const a = previous
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
      previous += 2

      direction.applyAxisAngle(up, curve / steps)
      position.addScaledVector(direction, SEGMENT)
      position.y += ramp / steps
    }
  }

  return {
    vertices,
    indices,
    centre,

    addSegment,

    addJump (length, height) {
      addSegment(length, 0, height)
      // Break the strip: the take-off and the landing must not be stitched to
      // each other, or the jump is a ramp with a roof on it.
      position.addScaledVector(direction, length * 1.4)
      previous = -1
      addSegment(length, 0, -height)
    },
  }
}

export function proceduralTrack (): TrackBundle {
  const walk = createWalk(new THREE.Vector3(0, 1, 20), new THREE.Vector3(0, 0, -1))

  walk.addSegment(320, 0, 0)
  walk.addSegment(420, Math.PI / 2, 6)
  walk.addSegment(360, 0, 0)
  walk.addJump(120, 12)
  walk.addSegment(300, 0, 0)
  walk.addSegment(420, Math.PI / 2, -6)
  walk.addSegment(520, 0, 0)
  walk.addSegment(420, Math.PI / 2, 0)
  walk.addSegment(560, 0, 0)
  walk.addSegment(420, Math.PI / 2, 0)
  walk.addSegment(240, 0, 0)

  const vertices = new Float32Array(walk.vertices)
  const indices  = new Uint32Array(walk.indices)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()

  // ~14 evenly-spaced checkpoints along the centreline.
  const step      = Math.max(1, Math.floor(walk.centre.length / 14))
  const waypoints = walk.centre.filter((_, i) => i % step === 0)

  return {
    geometry,
    vertices,
    spec: {
      id:             'procedural',
      name:           'Procedural Sprint',
      background:     '#0d0d16',
      // The shared 20-80 canvas fog this inherited under R3F would have
      // swallowed a ~3500-unit sprint; given a range that matches the track.
      fog:            [ '#0d0d16', 140, 950 ],
      waypoints:      waypoints.map(p => [ p.x, p.y, p.z ] as Vec3Tuple),
      width:          WIDTH,
      laps:           1,
      loop:           false,
      colliders:      [
        ...ribbonBoxColliders(vertices, { stride: 1 }),
        ...ribbonWallColliders(vertices, { height: WALL_HEIGHT, stride: 1 }),
      ],
      colliderOffset: [ 0, -0.05, 0 ],
      bloom:          { strength: 0.3, threshold: 0.9, radius: 0.45 },
    },
  }
}
