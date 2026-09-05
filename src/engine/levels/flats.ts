/**
 * The Flats, drawn.
 *
 * The deck's shape — waypoints, slab, walls — is data now and lives in
 * `@crash-velocity/race`, because the server builds the same colliders without
 * ever loading three.js. This is only what you look at.
 */

import * as THREE from 'three'
import { FLATS_HALF, FLATS_WALLS } from '@crash-velocity/race'

import type { SceneContext } from 'threejs-scene'
import type { TrackBundle } from '@crash-velocity/race'


export function buildFlats (ctx: SceneContext, bundle: TrackBundle): void {
  const waypoints = bundle.spec.waypoints.map(p => new THREE.Vector3(p[0], p[1], p[2]))

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(FLATS_HALF * 2, FLATS_HALF * 2),
    new THREE.MeshStandardMaterial({ color: '#15161f', metalness: 0.1, roughness: 0.95 })
  )
  floor.rotation.x    = -Math.PI / 2
  floor.receiveShadow = true
  ctx.scene.add(floor)

  // Grid so motion + turning read clearly while tuning.
  const grid      = new THREE.GridHelper(FLATS_HALF * 2, 80, '#3a3f55', '#23263a')
  grid.position.y = 0.02
  ctx.scene.add(grid)

  // Emissive racing-line markers, batched by colour: the glow comes from
  // `emissive`, which InstancedMesh cannot vary per instance (setColorAt
  // only tints `color`), so one mesh per colour instead of 16 meshes.
  const ringGeometry = new THREE.RingGeometry(1.6, 2.2, 24)
  const matrix       = new THREE.Matrix4()
  const flat         = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
  const unit         = new THREE.Vector3(1, 1, 1)
  const position     = new THREE.Vector3()

  const groups: Array<{ colour: string; points: THREE.Vector3[] }> = [
    { colour: '#22d3ee', points: waypoints.slice(0, 1) }, // start/finish
    { colour: '#ff2d6f', points: waypoints.slice(1) },
  ]

  for (const group of groups) {
    const material = new THREE.MeshStandardMaterial({
      color:             group.colour,
      emissive:          group.colour,
      emissiveIntensity: 1.4,
      side:              THREE.DoubleSide,
    })
    const mesh = new THREE.InstancedMesh(ringGeometry, material, group.points.length)
    group.points.forEach((point, i) => {
      matrix.compose(position.set(point.x, 0.05, point.z), flat, unit)
      mesh.setMatrixAt(i, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    ctx.scene.add(mesh)
  }

  // Containment fence, built FROM the wall colliders (half-extents -> full
  // box dimensions) so the mesh cannot drift from the thing that stops you.
  const fenceMaterial = new THREE.MeshStandardMaterial({
    color:             '#22d3ee',
    emissive:          '#22d3ee',
    emissiveIntensity: 0.35,
    transparent:       true,
    opacity:           0.16,
    side:              THREE.DoubleSide,
    depthWrite:        false,
  })
  for (const wall of FLATS_WALLS) {
    const [ hx, hy, hz ] = wall.args
    const panel          = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2),
      fenceMaterial
    )
    panel.position.set(wall.position[0], wall.position[1], wall.position[2])
    ctx.scene.add(panel)

    // A 16%-opacity slab is nearly invisible edge-on at 200 units out, which
    // is exactly the approach angle you hit it from. The lit cap is what you
    // actually read as "wall" while driving at it.
    const cap      = new THREE.Mesh(
      new THREE.BoxGeometry(hx * 2, 0.25, hz * 2),
      new THREE.MeshStandardMaterial({
        color:             '#22d3ee',
        emissive:          '#22d3ee',
        emissiveIntensity: 1.6,
      })
    )
    cap.position.set(wall.position[0], wall.position[1] + hy, wall.position[2])
    ctx.scene.add(cap)
  }

  ctx.scene.add(new THREE.HemisphereLight('#8a9bff', '#0a0c14', 0.7))

  const overhead = new THREE.PointLight('#aab4ff', 120, 400)
  overhead.position.set(0, 60, 0)
  ctx.scene.add(overhead)

  ctx.scene.fog = new THREE.Fog('#0a0c14', 150, 500)
}
