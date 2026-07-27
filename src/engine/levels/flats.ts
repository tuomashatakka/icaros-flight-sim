import * as THREE from 'three'
import type { BoxCollider } from '@/lib/track/build-track'
import type { LevelSpec } from './types'


const HALF = 200 // ground half-extent
const WALL = 150 // perimeter wall distance from origin

/**
 * The Flats — a single perfectly flat ground plane (y = 0) used to validate the
 * driving model in isolation: no banking, no gaps, world-up === the ship's up,
 * so steering is pure yaw about Y. An elliptical checkpoint loop sits on the
 * deck and low perimeter walls keep the ship in. Tune handling here before the
 * 3D tracks.
 */
export function flatsLevel (): LevelSpec {
  // Elliptical racing line on the flat deck (y = 0).
  const rx        = 90
  const rz        = 62
  const count     = 16
  const waypoints = Array.from({ length: count }, (_, i) => {
    const a = i / count * Math.PI * 2
    return new THREE.Vector3(Math.cos(a) * rx, 0, Math.sin(a) * rz)
  })

  // One big slab so the raycast-vehicle wheels always find ground, plus walls.
  const colliders: BoxCollider[] = [
    { position: [ 0, -0.5, 0 ], rotation: [ 0, 0, 0 ], args: [ HALF, 0.5, HALF ]},
    { position: [ 0, 3, WALL ], rotation: [ 0, 0, 0 ], args: [ WALL, 3, 1 ]},
    { position: [ 0, 3, -WALL ], rotation: [ 0, 0, 0 ], args: [ WALL, 3, 1 ]},
    { position: [ WALL, 3, 0 ], rotation: [ 0, 0, 0 ], args: [ 1, 3, WALL ]},
    { position: [ -WALL, 3, 0 ], rotation: [ 0, 0, 0 ], args: [ 1, 3, WALL ]},
  ]

  return {
    id:         'flats',
    background: '#0a0c14',
    // The shared 20-80 fog would swallow a 400-unit deck; give it real range.
    fog:        [ '#0a0c14', 150, 500 ],

    waypoints,
    width: 18,
    laps:  3,
    loop:  true,

    colliders,
    colliderOffset: [ 0, 0, 0 ],

    // NOTE: `createBloom` is UnrealBloomPass-shaped, so `threshold` is a HARD
    // knee in linear space — not pmndrs' soft `luminanceThreshold`. Porting 0.7
    // across blew out the whole hull, because a lit white ship sits well above
    // it. These values are re-tuned by eye, not translated.
    bloom: { strength: 0.32, threshold: 0.92, radius: 0.45 },

    build (ctx) {
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(HALF * 2, HALF * 2),
        new THREE.MeshStandardMaterial({ color: '#15161f', metalness: 0.1, roughness: 0.95 })
      )
      floor.rotation.x    = -Math.PI / 2
      floor.receiveShadow = true
      ctx.scene.add(floor)

      // Grid so motion + turning read clearly while tuning.
      const grid      = new THREE.GridHelper(HALF * 2, 80, '#3a3f55', '#23263a')
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

      ctx.scene.add(new THREE.HemisphereLight('#8a9bff', '#0a0c14', 0.7))

      const overhead = new THREE.PointLight('#aab4ff', 120, 400)
      overhead.position.set(0, 60, 0)
      ctx.scene.add(overhead)

      ctx.scene.fog = new THREE.Fog('#0a0c14', 150, 500)
    },
  }
}
