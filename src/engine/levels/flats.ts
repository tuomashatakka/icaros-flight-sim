import * as THREE from 'three'
import type { BoxCollider } from '@/lib/track/build-track'
import type { LevelSpec } from './types'


const HALF   = 200 // ground half-extent
// Half-height. Generous on purpose: a hovercraft doing 50 m/s into a short
// barrier rides up the face and straight over the top, and a tuning deck you can
// leave by accident wastes a scenario run on a fall-through that says nothing
// about handling.
const WALL_H = 10
const WALL_T = 3 // perimeter wall half-thickness

/**
 * How far the wall is buried below the deck.
 *
 * Its bottom face used to sit at exactly y = 0, coplanar with the top of the
 * ground slab, and a hovercraft arriving at 47 m/s squeezed straight through
 * that seam: the impact bled some speed, the contact solver pushed the hull
 * down as much as back, and once the chassis was below y = 0 it was below the
 * wall entirely and simply carried on into the void. Overlapping the slab means
 * there is no seam to find.
 */
const WALL_SINK = 2

/**
 * Perimeter walls, as half-extents. `build()` draws a mesh per entry from these
 * exact numbers rather than repeating them, so the fence you see is the fence
 * you hit — these were physics-only for a long time, which reads in play as the
 * deck randomly refusing to let you leave.
 *
 * They sit at ±HALF, flush with the edge of the ground slab: a wall parked
 * inboard of the floor just shrinks the usable deck for no reason.
 */
const WALLS: BoxCollider[] = [
  { position: [ 0, WALL_H - WALL_SINK, HALF ], rotation: [ 0, 0, 0 ], args: [ HALF, WALL_H, WALL_T ]},
  { position: [ 0, WALL_H - WALL_SINK, -HALF ], rotation: [ 0, 0, 0 ], args: [ HALF, WALL_H, WALL_T ]},
  { position: [ HALF, WALL_H - WALL_SINK, 0 ], rotation: [ 0, 0, 0 ], args: [ WALL_T, WALL_H, HALF ]},
  { position: [ -HALF, WALL_H - WALL_SINK, 0 ], rotation: [ 0, 0, 0 ], args: [ WALL_T, WALL_H, HALF ]},
]

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

  // One big slab so the hover rays always find ground, plus the walls above.
  // The slab is centred at -0.5 with a 0.5 half-extent, so its TOP face is flush
  // at y = 0 where the floor mesh is drawn.
  const colliders: BoxCollider[] = [
    { position: [ 0, -0.5, 0 ], rotation: [ 0, 0, 0 ], args: [ HALF, 0.5, HALF ]},
    ...WALLS,
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
      for (const wall of WALLS) {
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
    },
  }
}
