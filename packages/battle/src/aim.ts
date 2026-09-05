import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-deterministic-compat'


/**
 * Where a shot starts and which way it goes.
 *
 * The authority for this is `BattleSim`, and it stayed private there — so the
 * HUD had no way to draw where the guns actually point and fell back to a
 * reticle pinned at screen centre. Extracting it is the same discipline
 * `hitscan.ts` and `protocol.ts` already follow: one definition, both halves,
 * agreement by construction rather than by a hand-typed mirror.
 *
 * Pure and rapier-free apart from `castArenaRay`, which needs a world to ask.
 */

/** Muzzle height above the chassis origin — beams leave the nose, not the skirt. */
export const MUZZLE_Y = 0.45
export const MUZZLE_Z = 2.6

const _fwd     = new THREE.Vector3()
const _aimAxis = new THREE.Vector3()
const _aimQuat = new THREE.Quaternion()

/** Ship-forward unit vector for a chassis orientation. */
export function forwardFrom (out: THREE.Vector3, rotation: THREE.Quaternion): THREE.Vector3 {
  return out.set(0, 0, 1).applyQuaternion(rotation)
}

/**
 * The aim vector: ship-forward tipped by the vertical trim.
 *
 * Kept separate from the hull's facing rather than folded into it, because the
 * muzzle position still wants the true forward — only what the guns and the
 * lock cone point AT should move.
 */
export function aimFrom (
  out: THREE.Vector3,
  rotation: THREE.Quaternion,
  aimAngle: number
): THREE.Vector3 {
  forwardFrom(out, rotation)
  if (!aimAngle)
    return out

  // Rotate about the ship's own lateral axis so the trim stays relative to the
  // hull as it banks, instead of drifting when the ship rolls. Negative because
  // +X here is the ship's LEFT (forward is +Z), so a positive rotation about it
  // drops the nose.
  _aimAxis.set(1, 0, 0).applyQuaternion(rotation)
  _aimQuat.setFromAxisAngle(_aimAxis, -aimAngle)
  return out.applyQuaternion(_aimQuat).normalize()
}

/** Muzzle position in world space, for a chassis pose. */
type PositionType = { x: number; y: number; z: number }

export function muzzleFrom (
  out: THREE.Vector3,
  position: PositionType,
  rotation: THREE.Quaternion
): THREE.Vector3 {
  forwardFrom(_fwd, rotation)
  return out.set(
    position.x + _fwd.x * MUZZLE_Z,
    position.y + MUZZLE_Y + _fwd.y * MUZZLE_Z,
    position.z + _fwd.z * MUZZLE_Z
  )
}

/** Ray filter: arena geometry only. Ships never occlude a shot at another ship. */
export function isArenaCollider (collider: RAPIER.Collider): boolean {
  const body = collider.parent()
  return !(body?.userData as { isVehicle?: boolean } | undefined)?.isVehicle
}

/**
 * Distance to the first piece of ARENA along a ray, or Infinity.
 *
 * Vehicles are skipped by the predicate: this answers "is a mesa in the way",
 * which is the question the lock, the beams and the HUD's impact marker all
 * need. Without it every plateau would be transparent to weapons and the
 * level's cover would be decoration.
 *
 * @param ray - A caller-owned `RAPIER.Ray`, reused so the hot path allocates
 * nothing. Its origin and direction are overwritten.
 */
export function castArenaRay (
  world: RAPIER.World,
  ray: RAPIER.Ray,
  from: THREE.Vector3,
  dir: THREE.Vector3,
  maxToi: number
): number {
  ray.origin.x = from.x
  ray.origin.y = from.y
  ray.origin.z = from.z
  ray.dir.x    = dir.x
  ray.dir.y    = dir.y
  ray.dir.z    = dir.z

  const hit = world.castRay(ray, maxToi, true, undefined, undefined, undefined, undefined, isArenaCollider)
  return hit ? hit.timeOfImpact : Number.POSITIVE_INFINITY
}
