/**
 * The procedural sprint — a hand-walked ribbon with a branching shortcut, a
 * jump, and a hand-stitched merge. One lap, no loop.
 *
 * The explicit merge bridges below must survive: `ribbonBoxColliders` only
 * bridges array-adjacent rings, and the junction stitches rings that are NOT
 * adjacent in the vertex array. Without them the drivable surface has a hole
 * exactly where the two routes rejoin.
 */

import * as THREE from 'three'

import { boxColliderFromRing, ribbonBoxColliders } from '../track-geometry'

import type { TrackBundle } from './types'
import type { Vec3Tuple } from '../track'


export function proceduralTrack (): TrackBundle {
  const segmentLength               = 20
  const verts: number[]             = []
  const idxs: number[]              = []
  const centerline: THREE.Vector3[] = []
  let lastVertexIndex  = -1
  let currentPosition  = new THREE.Vector3(-1, 1, 14)
  let currentDirection = new THREE.Vector3(0, 0, -1)

  // `record` collects centerline points for the main racing line only (skips
  // the shortcut + jump), giving the race module an ordered branch-free
  // checkpoint path.
  const addSegment = (length: number, curve: number, ramp: number, width: number, record = false) => {
    const segments = Math.max(1, Math.floor(length / segmentLength))
    for (let i = 0; i < segments; i++) {
      if (record)
        centerline.push(currentPosition.clone())

      const sideVector = new THREE.Vector3()
        .crossVectors(currentDirection, new THREE.Vector3(0, 1, 0))
        .normalize()
      const leftVertex  = currentPosition.clone().add(sideVector.clone().multiplyScalar(width / 2))
      const rightVertex = currentPosition.clone().add(sideVector.clone().multiplyScalar(-width / 2))

      verts.push(leftVertex.x, leftVertex.y, leftVertex.z)
      verts.push(rightVertex.x, rightVertex.y, rightVertex.z)

      if (lastVertexIndex >= 0) {
        const i0 = lastVertexIndex
        const i1 = i0 + 1
        const i2 = i0 + 2
        const i3 = i2 + 1
        idxs.push(i0, i1, i2)
        idxs.push(i1, i3, i2)
      }
      lastVertexIndex += 2

      currentDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), curve / segments)
      currentPosition.add(currentDirection.clone().multiplyScalar(segmentLength))
      currentPosition.y += ramp / segments
    }
  }

  const addJump = (length: number, height: number, width: number) => {
    addSegment(length, 0, height, width)
    currentPosition.add(currentDirection.clone().multiplyScalar(length * 1.5))
    lastVertexIndex = -1 // Create a gap
    addSegment(length, 0, -height, width)
  }

  // --- Track generation ---
  addSegment(200, 0, 0, 20, true)

  // --- PATH SPLIT ---
  const splitPosition  = currentPosition.clone()
  const splitDirection = currentDirection.clone()
  const splitLastIndex = lastVertexIndex

  // Route 1: longer, safer curve.
  addSegment(400, Math.PI / 2, 5, 20, true)
  addSegment(200, 0, 0, 20, true)

  const mergePosition1  = currentPosition.clone()
  const mergeDirection1 = currentDirection.clone()
  const mergeIndex1     = lastVertexIndex

  // Reset for route 2.
  currentPosition = splitPosition.clone()
  currentDirection = splitDirection.clone()
  lastVertexIndex = splitLastIndex

  // Route 2: shorter, riskier shortcut with a jump.
  addSegment(50, -Math.PI / 8, 0, 10)
  addJump(100, 15, 10)
  addSegment(50, Math.PI / 8, -5, 10)

  // Manual merge connection — capture the rings being stitched before they are
  // overwritten by the reset below.
  const lastLeftVert    = new THREE.Vector3(verts[verts.length - 6], verts[verts.length - 5], verts[verts.length - 4])
  const lastRightVert   = new THREE.Vector3(verts[verts.length - 3], verts[verts.length - 2], verts[verts.length - 1])
  const merge1LeftVert  = new THREE.Vector3(verts[mergeIndex1 * 3 - 3], verts[mergeIndex1 * 3 - 2], verts[mergeIndex1 * 3 - 1])
  const merge1RightVert = new THREE.Vector3(verts[mergeIndex1 * 3], verts[mergeIndex1 * 3 + 1], verts[mergeIndex1 * 3 + 2])

  currentPosition = mergePosition1.clone()
  currentDirection = mergeDirection1.clone()
  lastVertexIndex = mergeIndex1

  const sideVector = new THREE.Vector3()
    .crossVectors(currentDirection, new THREE.Vector3(0, 1, 0))
    .normalize()
  const leftVertex  = currentPosition.clone().add(sideVector.clone().multiplyScalar(20 / 2))
  const rightVertex = currentPosition.clone().add(sideVector.clone().multiplyScalar(-20 / 2))

  verts.push(leftVertex.x, leftVertex.y, leftVertex.z)
  verts.push(rightVertex.x, rightVertex.y, rightVertex.z)

  const mergePointIndex = lastVertexIndex + 2

  // Connect shortcut to merge point.
  idxs.push(lastVertexIndex - 1, mergePointIndex + 1, lastVertexIndex)
  idxs.push(lastVertexIndex - 1, mergePointIndex, mergePointIndex + 1)
  // Connect main route to merge point.
  idxs.push(mergeIndex1, mergeIndex1 + 1, mergePointIndex)
  idxs.push(mergeIndex1 + 1, mergePointIndex + 1, mergePointIndex)

  lastVertexIndex = mergePointIndex

  // Bridge the non-adjacent junction rings explicitly, so the drivable surface
  // has a collider everywhere the rendered mesh does.
  const mergeBridgeColliders = [
    boxColliderFromRing(merge1LeftVert, merge1RightVert, leftVertex, rightVertex),
    boxColliderFromRing(lastLeftVert, lastRightVert, leftVertex, rightVertex),
  ].filter((b): b is NonNullable<typeof b> => b !== null)

  // --- Continue after merge ---
  addSegment(500, 0, 0, 20, true)
  addSegment(400, Math.PI / 2, 0, 20, true)
  addSegment(500, 0, -5, 20, true)
  addSegment(400, Math.PI / 2, 0, 20, true)
  addSegment(700, 0, 0, 20, true)
  addSegment(400, Math.PI / 2, 0, 20, true)

  const vertices = new Float32Array(verts)
  const indices  = new Uint32Array(idxs)

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.computeVertexNormals()

  // Decimate to ~12 evenly-spaced checkpoints along the main racing line.
  const step      = Math.max(1, Math.floor(centerline.length / 12))
  const waypoints = centerline.filter((_, i) => i % step === 0)

  return {
    geometry,
    spec: {
      id:             'procedural',
      name:           'Procedural Sprint',
      background:     '#171720',
      // The shared 20-80 canvas fog this inherited under R3F would have
      // swallowed a ~3000-unit sprint; given a range that matches the track.
      fog:            [ '#171720', 120, 900 ],
      waypoints:      waypoints.map(p => [ p.x, p.y, p.z ] as Vec3Tuple),
      width:          20,
      laps:           1,
      loop:           false,
      colliders:      [ ...ribbonBoxColliders(vertices, { stride: 1 }), ...mergeBridgeColliders ],
      colliderOffset: [ 0, -0.05, 0 ],
      bloom:          { strength: 0.3, threshold: 0.9, radius: 0.45 },
    },
  }
}
