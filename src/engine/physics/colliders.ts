import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { BoxCollider } from '@/lib/track/build-track'
import type { Physics } from './world'

// Hoisted — collider construction is a burst at level load, but there can be
// hundreds of boxes per track and there is no reason to allocate per box.
const _euler = new THREE.Euler()
const _quat  = new THREE.Quaternion()

/**
 * Attach a strip of oriented boxes to one fixed body.
 *
 * The drivable surface is hundreds of thin cuboids rather than a trimesh. It
 * began as a workaround — rapier's raycast-vehicle wheels did not collide with
 * trimeshes — and survives the move to hover rays for a different reason: a ray
 * against a box returns one clean face normal, where a trimesh returns
 * per-triangle normals that make the hull twitch at every seam. There is
 * deliberately no trimesh path here.
 *
 * @param offset - World offset applied to the whole strip (the old fixed
 * RigidBody's position).
 */
export function attachBoxColliders (
  physics: Physics,
  boxes: readonly BoxCollider[],
  offset: readonly [number, number, number] = [ 0, 0, 0 ]
): RAPIER.RigidBody {
  const { RAPIER, world } = physics

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(offset[0], offset[1], offset[2])
  )

  for (const box of boxes) {
    _euler.set(box.rotation[0], box.rotation[1], box.rotation[2])
    _quat.setFromEuler(_euler)

    world.createCollider(
      RAPIER.ColliderDesc.cuboid(box.args[0], box.args[1], box.args[2])
        .setTranslation(box.position[0], box.position[1], box.position[2])
        .setRotation({ x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w }),
      body
    )
  }

  return body
}

/** Attach a single axis-aligned box (perimeter walls, ground slabs). */
export function attachBox (
  physics: Physics,
  body: RAPIER.RigidBody,
  halfExtents: readonly [number, number, number],
  position: readonly [number, number, number]
): RAPIER.Collider {
  const { RAPIER, world } = physics
  return world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfExtents[0], halfExtents[1], halfExtents[2]).setTranslation(
      position[0],
      position[1],
      position[2]
    ),
    body
  )
}
