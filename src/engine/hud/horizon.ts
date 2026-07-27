import * as THREE from 'three'
import { createBar } from './frame'
import type { HoloMesh, HoloPart } from './frame'
import { createHoloMaterial, HOLO } from './materials'
import type { HoloMaterial } from './materials'


const _forward = new THREE.Vector3()
const _right   = new THREE.Vector3()
const _up      = new THREE.Vector3()

export type Horizon = HoloPart & {

  /**
   * Re-level the ladder against the hull.
   *
   * The HUD group rides `shipRoot`, so it inherits the hull's roll and pitch —
   * which is right for the canopy (it is part of the ship) and wrong for the
   * horizon (it represents the WORLD). This counter-rotates by exactly the
   * hull's attitude so the bar stays on the real horizon while everything
   * around it banks.
   */
  update(hullQuaternion: THREE.Quaternion): void;
}

/** Vertical span of the ladder per radian of pitch. */
const PITCH_SCALE = 0.62

/**
 * Artificial horizon: a centre reticle fixed to the hull, and a pitch/roll
 * ladder that tracks the world.
 */
export function createHorizon (): Horizon {
  const group                     = new THREE.Group()
  const ladder                    = new THREE.Group()
  const materials: HoloMaterial[] = []
  const disposers: (() => void)[] = []

  const add = (
    part: HoloMesh,
    parent: THREE.Object3D
  ) => {
    materials.push(part.material)
    disposers.push(part.dispose)
    parent.add(part.mesh)
    return part.mesh
  }

  // The horizon line itself, broken in the middle so it never hides the reticle.
  for (const sign of [ -1, 1 ]) {
    const bar = add(createBar(0.46, 0.006, { color: HOLO.cyan, opacity: 0.85, gain: 1.0 }), ladder)
    bar.position.set(sign * 0.34, 0, 0)
  }

  // Pitch rungs above and below, shorter the further out they sit.
  for (let i = -4; i <= 4; i++) {
    if (i === 0)
      continue

    const width = i % 2 === 0 ? 0.24 : 0.13
    const rung  = add(createBar(width, 0.004, {
      color:   HOLO.cyan,
      opacity: 0.42,
      gain:    1.6,
    }), ladder)
    rung.position.set(0, i * 0.09, 0)
  }

  group.add(ladder)

  // Fixed reticle — belongs to the ship, so it stays out of the counter-rotated
  // ladder and marks where the nose is actually pointing.
  const reticleGeometry = new THREE.RingGeometry(0.018, 0.023, 24)
  const reticleMaterial = createHoloMaterial({ color: HOLO.amber, opacity: 1, gain: 1.5 })
  const reticle         = new THREE.Mesh(reticleGeometry, reticleMaterial)
  materials.push(reticleMaterial)
  disposers.push(() => {
    reticleGeometry.dispose()
    reticleMaterial.dispose()
  })
  group.add(reticle)

  for (const sign of [ -1, 1 ]) {
    const tick = add(createBar(0.05, 0.005, { color: HOLO.amber, opacity: 0.9, gain: 1.3 }), group)
    tick.position.set(sign * 0.055, 0, 0)
  }

  return {
    object: group,
    materials,

    update (hullQuaternion) {
      _forward.set(0, 0, 1).applyQuaternion(hullQuaternion)
      // SCREEN right, which is the ship's -X: the camera looks down the ship's
      // +Z, so its right axis is the negative one. Using +X here inverts the
      // roll and the ladder banks the wrong way.
      _right.set(-1, 0, 0).applyQuaternion(hullQuaternion)
      _up.set(0, 1, 0).applyQuaternion(hullQuaternion)

      // Roll is the tilt of the hull's right axis out of the world horizontal;
      // taking it from the right vector rather than from euler angles avoids the
      // gimbal flip you get decomposing a quaternion near vertical.
      const roll  = Math.atan2(_right.y, _up.y)
      const pitch = Math.asin(THREE.MathUtils.clamp(_forward.y, -1, 1))

      ladder.rotation.z = -roll
      ladder.position.y = -pitch * PITCH_SCALE
    },

    dispose () {
      for (const dispose of disposers)
        dispose()
    },
  }
}
