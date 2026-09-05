/**
 * The Flats, drawn.
 *
 * The deck's shape — waypoints, slab, walls — is data now and lives in
 * `@crash-velocity/race`, because the server builds the same colliders without
 * ever loading three.js. This is only what you look at.
 */

import * as THREE from 'three'
import { FLATS_HALF, FLATS_WALLS } from 'Λ'
import { finaliseStaticScene } from './shared'

import type { SceneContext } from 'threejs-scene'
import type { TrackBundle } from 'Λ'
import type { EnvironmentOverrides } from '../environment'


/**
 * How this track differs from `DEFAULT_ENVIRONMENT`.
 *
 * Sky colour, fog range and the fill tint are level identity; the key-to-fill
 * ratio is not. Every track used to add its own hemisphere light on top of the
 * base rig, which is what buried the ship's shadow — so a level states deltas
 * here and never adds an ambient light of its own. Point lights placed in the
 * build below are still fine: those are set dressing, not fill.
 */
export const flatsEnvironment: EnvironmentOverrides = {
  background: '#0a0c14',

  // The shared 150-500 default already suits a 400-unit deck.
  hemi: { sky: '#8a9bff', ground: '#0a0c14', intensity: 1.08 },
}

export function buildFlats (ctx: SceneContext, bundle: TrackBundle): void {
  const root      = new THREE.Group()
  const waypoints = bundle.spec.waypoints.map(p => new THREE.Vector3(p[0], p[1], p[2]))

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(FLATS_HALF * 2, FLATS_HALF * 2),
    new THREE.MeshStandardMaterial({ color: '#15161f', metalness: 0.1, roughness: 0.95 })
  )
  floor.rotation.x    = -Math.PI / 2
  floor.receiveShadow = true
  root.add(floor)

  // Grid so motion + turning read clearly while tuning.
  const grid      = new THREE.GridHelper(FLATS_HALF * 2, 80, '#3a3f55', '#23263a')
  grid.position.y = 0.02
  root.add(grid)

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
    root.add(mesh)
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
  const fenceGeometry = new THREE.BoxGeometry(1, 1, 1)
  const capMaterial   = new THREE.MeshStandardMaterial({
    color: '#22d3ee', emissive: '#22d3ee', emissiveIntensity: 1.6,
  })
  const panels      = new THREE.InstancedMesh(fenceGeometry, fenceMaterial, FLATS_WALLS.length)
  const caps        = new THREE.InstancedMesh(fenceGeometry, capMaterial, FLATS_WALLS.length)
  const fenceMatrix = new THREE.Matrix4()
  const rotation    = new THREE.Quaternion()
  const at          = new THREE.Vector3()
  const scale       = new THREE.Vector3()
  FLATS_WALLS.forEach((wall, i) => {
    const [ hx, hy, hz ] = wall.args
    panels.setMatrixAt(i, fenceMatrix.compose(at.set(...wall.position), rotation, scale.set(hx * 2, hy * 2, hz * 2)))

    // A 16%-opacity slab is nearly invisible edge-on at 200 units out, which
    // is exactly the approach angle you hit it from. The lit cap is what you
    // actually read as "wall" while driving at it.
    caps.setMatrixAt(i, fenceMatrix.compose(at.set(wall.position[0], wall.position[1] + hy, wall.position[2]), rotation, scale.set(hx * 2, 0.25, hz * 2)))
  })
  panels.instanceMatrix.needsUpdate = caps.instanceMatrix.needsUpdate = true
  root.add(panels, caps)


  const overhead = new THREE.PointLight('#aab4ff', 120, 400)
  overhead.position.set(0, 60, 0)
  root.add(overhead)

  finaliseStaticScene('flats', root)
  ctx.scene.add(root)
}
