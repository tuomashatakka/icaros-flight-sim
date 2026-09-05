import * as THREE from 'three'


/**
 * Point-and-go steering, as pure functions.
 *
 * Separated from the pointer plumbing because this is the part with a right
 * answer: where a tap lands in the world, and which way to turn to get there.
 * Both are testable without a DOM, a camera rig or a rapier world — which
 * matters, because the sign of a yaw command is exactly the kind of thing that
 * is a coin toss on paper and obvious the moment it drives in a circle.
 *
 * Nothing here touches physics. It produces the same `Controls` a thumb or a
 * key would, and `packages/physics` remains the only authority on how the ship
 * responds to them.
 */

const _ray    = new THREE.Ray()
const _plane  = new THREE.Plane()
const _fwd    = new THREE.Vector3()
const _toGoal = new THREE.Vector3()
const _origin = new THREE.Vector3()
const _dir    = new THREE.Vector3()
const _ndc    = new THREE.Vector3()

/** Compass bearing of a direction, radians. Matches `hud/instruments.ts#headingFrom`. */
export function bearingOf (direction: THREE.Vector3): number {
  return Math.atan2(direction.x, direction.z)
}

/** Shortest signed angle from `from` to `to`, radians in (-PI, PI]. */
export function angleDelta (from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

/**
 * Where a screen tap meets the ground, in world space.
 *
 * Intersects the tap ray with a HORIZONTAL PLANE at the ship's own height
 * rather than raycasting the track. A plane cannot miss: a ray cast at scenery
 * returns nothing when the tap lands on sky, on a gap in the track, or past the
 * draw distance, and "nothing happened" is indistinguishable from a broken
 * control. The ship hovers at a roughly constant height anyway, so the plane is
 * where the track is to within the suspension's travel.
 *
 * Returns false only when the ray runs parallel to the plane — a tap exactly on
 * the horizon.
 */
export function tapGroundPoint (
  camera: THREE.Camera,
  ndcX: number,
  ndcY: number,
  planeY: number,
  out: THREE.Vector3
): boolean {
  _origin.setFromMatrixPosition(camera.matrixWorld)
  _dir.copy(_ndc.set(ndcX, ndcY, 0.5))
    .unproject(camera)
    .sub(_origin)
    .normalize()

  _ray.set(_origin, _dir)
  _plane.setComponents(0, 1, 0, -planeY)
  return _ray.intersectPlane(_plane, out) !== null
}

export type SteerCommand = {

  /** -1 (left) .. 1 (right), the sign convention `Controls.steer` uses. */
  steer: number;

  /** Whether to hold thrust this frame. */
  throttle: boolean;

  /** True once the ship is inside `arriveRadius` and the target is spent. */
  arrived: boolean;
}

/** Yaw error at which `steer` saturates, radians. Beyond this it is full lock. */
const FULL_LOCK = 0.7

/**
 * Widest yaw error the ship will thrust through, radians (~80 deg).
 *
 * Past this it turns on the spot instead. Thrusting at a target behind you on a
 * craft with this much sideslip means a long, wide arc that overshoots and comes
 * back — it reads as the ship ignoring the tap.
 */
const THRUST_CONE = 1.4

export function steerToward (
  shipPosition: THREE.Vector3,
  hullQuaternion: THREE.Quaternion,
  target: THREE.Vector3,
  arriveRadius: number
): SteerCommand {
  _toGoal.copy(target).sub(shipPosition)
  _toGoal.y = 0

  const distance = _toGoal.length()
  if (distance <= arriveRadius)
    return { steer: 0, throttle: false, arrived: true }

  // The hull looks down its own +Z — the same convention `hud/anchor.ts` reads
  // it by. Flattened, because a banked ship's forward vector dips and the
  // bearing to a point on the ground is a compass bearing.
  _fwd.set(0, 0, 1).applyQuaternion(hullQuaternion)
  _fwd.y = 0

  if (_fwd.lengthSq() < 1e-6 || distance < 1e-6)
    return { steer: 0, throttle: false, arrived: false }

  const error = angleDelta(bearingOf(_fwd), bearingOf(_toGoal))

  return {
    steer:    THREE.MathUtils.clamp(error / FULL_LOCK, -1, 1),
    throttle: Math.abs(error) < THRUST_CONE,
    arrived:  false,
  }
}
