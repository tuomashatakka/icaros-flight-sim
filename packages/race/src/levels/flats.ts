/**
 * The Flats — one perfectly flat deck at y = 0, for validating the driving
 * model in isolation: no banking, no gaps, world-up IS the ship's up, so
 * steering is pure yaw about Y. Tune handling here before the 3D tracks.
 */

import type { BoxCollider } from 'Φcolliders'
import type { TrackBundle } from './types'
import type { Vec3Tuple } from '../track'


export const FLATS_HALF = 200

const WALL_H = 10 // half-height: generous, because a hovercraft at 50 m/s rides
//  up a short barrier and straight over the top
const WALL_T = 3

/**
 * How far the wall is buried below the deck.
 *
 * Its bottom face used to sit at exactly y = 0, coplanar with the top of the
 * ground slab, and a hovercraft arriving at 47 m/s squeezed through that seam:
 * the impact bled speed, the solver pushed the hull down as much as back, and
 * once the chassis was below y = 0 it was below the wall entirely. Overlapping
 * the slab means there is no seam to find.
 */
const WALL_SINK = 2

/**
 * Perimeter walls, as half-extents.
 *
 * Exported because the fence MESH is built from these exact numbers rather than
 * repeating them — these were physics-only for a long time, which reads in play
 * as the deck randomly refusing to let you leave.
 */
export const FLATS_WALLS: BoxCollider[] = [
  { position: [ 0, WALL_H - WALL_SINK, FLATS_HALF ], rotation: [ 0, 0, 0 ], args: [ FLATS_HALF, WALL_H, WALL_T ]},
  { position: [ 0, WALL_H - WALL_SINK, -FLATS_HALF ], rotation: [ 0, 0, 0 ], args: [ FLATS_HALF, WALL_H, WALL_T ]},
  { position: [ FLATS_HALF, WALL_H - WALL_SINK, 0 ], rotation: [ 0, 0, 0 ], args: [ WALL_T, WALL_H, FLATS_HALF ]},
  { position: [ -FLATS_HALF, WALL_H - WALL_SINK, 0 ], rotation: [ 0, 0, 0 ], args: [ WALL_T, WALL_H, FLATS_HALF ]},
]

export function flatsTrack (): TrackBundle {
  const rx    = 90
  const rz    = 62
  const count = 16

  const waypoints: Vec3Tuple[] = Array.from({ length: count }, (_, i) => {
    const a = i / count * Math.PI * 2
    return [ Math.cos(a) * rx, 0, Math.sin(a) * rz ]
  })

  // One big slab so the hover rays always find ground, plus the walls above.
  // Centred at -0.5 with a 0.5 half-extent, so its TOP face is flush at y = 0
  // where the floor mesh is drawn.
  const colliders: BoxCollider[] = [
    { position: [ 0, -0.5, 0 ], rotation: [ 0, 0, 0 ], args: [ FLATS_HALF, 0.5, FLATS_HALF ]},
    ...FLATS_WALLS,
  ]

  return {
    spec: {
      id:             'flats',
      name:           'The Flats',
      background:     '#0a0c14',
      // The shared 20-80 fog would swallow a 400-unit deck; give it real range.
      fog:            [ '#0a0c14', 150, 500 ],
      waypoints,
      width:          18,
      laps:           3,
      loop:           true,
      colliders,
      colliderOffset: [ 0, 0, 0 ],
      // NOTE: `createBloom` is UnrealBloomPass-shaped, so `threshold` is a HARD
      // knee in linear space — not pmndrs' soft `luminanceThreshold`. These
      // values are tuned by eye, not translated.
      bloom:          { strength: 0.32, threshold: 0.92, radius: 0.45 },
    },
  }
}
