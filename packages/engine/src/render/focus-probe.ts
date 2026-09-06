import * as THREE from 'three'
import type { Physics } from 'Φ'


/**
 * How far away the thing under the pointer is.
 *
 * The lens focuses on what you are LOOKING at, which on a mouse is what the
 * cursor is over and on a touchscreen is the middle of the frame — a thumb is
 * not a gaze, and racking focus to wherever a finger happens to rest on a stick
 * would defocus the track every time you steered.
 *
 * The ray goes into the rapier world, not the scene graph. A `THREE.Raycaster`
 * would have to walk every mesh in a level built out of instanced scenery and
 * test triangles against them; rapier already holds the same surfaces as a
 * broadphase of oriented boxes and answers in one call. The two agree because
 * the colliders and the road mesh are generated from one ribbon — that is the
 * whole reason the track is built the way it is.
 */

export type FocusProbe = {

  /** Latest pointer position in NDC, or null while the pointer has left. */
  setPointer(x: number | null, y: number | null): void;

  /**
   * Distance from the eye to whatever the pointer is over, world units.
   *
   * Falls back to `fallback` when the ray leaves the world — the sky has no
   * distance, and a lens pointed at it should sit at infinity rather than snap
   * to the near plane.
   */
  sample(camera: THREE.Camera, fallback: number): number;

  dispose(): void;
}

/** Longest ray we bother casting. Past this everything is at infinity anyway. */
const REACH = 900

export function createFocusProbe (physics: Physics, canvas: HTMLCanvasElement): FocusProbe {
  const { RAPIER, world } = physics

  const origin    = new THREE.Vector3()
  const direction = new THREE.Vector3()
  const ndc       = new THREE.Vector2()
  const far       = new THREE.Vector3()
  let hasPointer  = false

  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 })

  const onMove = (event: PointerEvent) => {
    // Mouse and pen only. A touch is a control input, not a gaze.
    if (event.pointerType === 'touch')
      return

    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0)
      return

    ndc.set(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      -((event.clientY - rect.top) / rect.height * 2 - 1)
    )
    hasPointer = true
  }

  const onLeave = () => {
    hasPointer = false
  }

  canvas.addEventListener('pointermove', onMove, { passive: true })
  canvas.addEventListener('pointerleave', onLeave)

  return {
    setPointer (x, y) {
      if (x === null || y === null) {
        hasPointer = false
        return
      }
      ndc.set(x, y)
      hasPointer = true
    },

    sample (camera, fallback) {
      // Centre of frame with no pointer, which is also what touch gets.
      far.set(hasPointer ? ndc.x : 0, hasPointer ? ndc.y : 0, 0.5).unproject(camera)
      camera.getWorldPosition(origin)
      direction.copy(far).sub(origin)
        .normalize()

      ray.origin.x = origin.x
      ray.origin.y = origin.y
      ray.origin.z = origin.z
      ray.dir.x    = direction.x
      ray.dir.y    = direction.y
      ray.dir.z    = direction.z

      const hit = world.castRay(ray, REACH, true)
      if (!hit)
        return fallback

      const toi = hit.timeOfImpact
      return Number.isFinite(toi) && toi > 0 ? toi : fallback
    },

    dispose () {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
    },
  }
}
