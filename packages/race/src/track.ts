/**
 * A track, as data, plus the gates derived from it.
 *
 * This is race's answer to battle's `BattleArena`: the shape of the world with
 * no renderer in it. The three.js `build()` closure that `LevelSpec` used to
 * carry is gone — it lives in `src/engine/levels/` now — because the server
 * instantiates one of these per room and must never load a scene graph to do it.
 *
 * Waypoints are plain tuples rather than `THREE.Vector3` so a track is
 * serialisable: it goes over the wire on join, and a client that has never
 * loaded the level's meshes can still predict against its gates.
 */

import { Vector3 } from 'three'

import type { BoxCollider } from 'Φcolliders'
import type { Transform } from 'Φtypes'


export type Vec3Tuple = [number, number, number]

export type TrackSpec = {
  id:         string;
  name:       string;
  background: string;

  /** `[color, near, far]`. Set explicitly per track rather than inherited. */
  fog: [string, number, number];

  /** Ordered centreline; checkpoint 0 is the start/finish line. */
  waypoints: Vec3Tuple[];

  /** Full road width, so gates span the track. */
  width: number;
  laps:  number;

  /** Closed circuit (lap-based) vs. open sprint (one run to the last gate). */
  loop: boolean;

  /** Drivable surface + walls, as oriented cuboids (never a trimesh). */
  colliders:      BoxCollider[];
  colliderOffset: Vec3Tuple;

  bloom: { strength: number; threshold: number; radius: number };
}

/**
 * One gate, as a plane the ship must cross the right way round.
 *
 * These used to be eight-metre rapier SENSOR cuboids, and the crossing arrived
 * through the physics event queue. That worked, but it cost a collider and an
 * event per gate per ship, it needed `EXCLUDE_SENSORS` on every hover raycast
 * to stop the pads finding "ground" on top of a gate, and the ordering of
 * intersection events across a tick was rapier's to decide rather than ours.
 *
 * A plane test is cheaper, exactly deterministic, and orders itself.
 */
export type Checkpoint = {
  index:     number;
  transform: Transform;

  /** Plane point and the direction of travel through it. */
  position: Vec3Tuple;
  forward:  Vec3Tuple;

  /** How far off the centreline still counts, and the vertical band. */
  halfWidth:  number;
  halfHeight: number;
}

const GATE_HEIGHT = 12
const GATE_LIFT   = 1.5

const _p       = new Vector3()
const _ahead   = new Vector3()
const _behind  = new Vector3()
const _forward = new Vector3()
const _right   = new Vector3()
const _up      = new Vector3()
const WORLD_UP = new Vector3(0, 1, 0)

/**
 * Build one oriented gate per waypoint.
 *
 * Forward is the direction of travel through the gate: on a loop that is the
 * next waypoint, on a sprint the previous-to-next span, so the first and last
 * gates of an open track still face the way the ship arrives.
 */
export function buildCheckpoints (track: TrackSpec): Checkpoint[] {
  const { waypoints, loop, width } = track
  const n                          = waypoints.length

  return waypoints.map((wp, i) => {
    _p.set(wp[0], wp[1], wp[2])

    const a = waypoints[(i + 1) % n]
    const b = waypoints[(i - 1 + n) % n]
    _ahead.set(a[0], a[1], a[2])
    _behind.set(b[0], b[1], b[2])

    _forward.copy(_ahead).sub(loop ? _p : _behind)
      .normalize()
    if (_forward.lengthSq() < 1e-6)
      _forward.set(0, 0, -1)

    _right.crossVectors(WORLD_UP, _forward).normalize()
    if (_right.lengthSq() < 1e-6)
      _right.set(1, 0, 0)

    _up.crossVectors(_forward, _right).normalize()

    // Basis → quaternion, by hand rather than through Matrix4: the caller may
    // be a server building this once per room, and it does not need a matrix.
    const quaternion = quaternionFromBasis(_right, _up, _forward)

    return {
      index:      i,
      transform:  { position: [ wp[0], wp[1] + GATE_LIFT, wp[2] ], quaternion },
      position:   [ wp[0], wp[1] + GATE_LIFT, wp[2] ],
      forward:    [ _forward.x, _forward.y, _forward.z ],
      halfWidth:  width / 2 + 2,
      halfHeight: GATE_HEIGHT / 2,
    }
  })
}

/**
 * Did the segment `from → to` pass through this gate, travelling forwards?
 *
 * Segment-versus-plane rather than point-inside-volume, so a ship at 200 m/s
 * cannot tunnel through a gate between two ticks — which an eight-metre sensor
 * cuboid could not promise either.
 */
export function crossedGate (gate: Checkpoint, from: Vec3Tuple, to: Vec3Tuple): boolean {
  const [ px, py, pz ] = gate.position
  const [ fx, fy, fz ] = gate.forward

  const before = (from[0] - px) * fx + (from[1] - py) * fy + (from[2] - pz) * fz
  const after  = (to[0] - px) * fx + (to[1] - py) * fy + (to[2] - pz) * fz

  // Must go from behind the plane to in front of it. Equal-or-greater on the
  // `after` side so a ship that stops exactly on the plane still counts.
  if (before > 0 || after < 0 || before === after)
    return false

  const t  = before / (before - after)
  const cx = from[0] + (to[0] - from[0]) * t
  const cy = from[1] + (to[1] - from[1]) * t
  const cz = from[2] + (to[2] - from[2]) * t

  // Lateral distance from the gate centre, measured in the plane.
  const dx    = cx - px
  const dy    = cy - py
  const dz    = cz - pz
  const along = dx * fx + dy * fy + dz * fz
  const lx    = dx - along * fx
  const ly    = dy - along * fy
  const lz    = dz - along * fz

  if (Math.abs(ly) > gate.halfHeight)
    return false

  return Math.hypot(lx, lz) <= gate.halfWidth
}

function quaternionFromBasis (right: Vector3, up: Vector3, forward: Vector3): [number, number, number, number] {
  const m00   = right.x,
    m01       = up.x,
    m02       = forward.x
  const m10   = right.y,
    m11       = up.y,
    m12       = forward.y
  const m20   = right.z,
    m21       = up.z,
    m22       = forward.z
  const trace = m00 + m11 + m22

  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    return [ (m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s ]
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    return [ 0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s ]
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    return [ (m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s ]
  }

  const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
  return [ (m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s ]
}
