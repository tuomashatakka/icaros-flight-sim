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

  // Where the canvas is, cached. `getBoundingClientRect` flushes layout, and
  //  this listener runs at the MOUSE's rate — up to 1 kHz on a gaming mouse,
  //  and a captured mouse reports every movement. Re-read only when the page
  //  says something could have moved it.
  const rect = { left: 0, top: 0, width: 0, height: 0 }
  let rectStale = true
  const invalidate = () => {
    rectStale = true
  }

  const onMove = (event: PointerEvent) => {
    // Mouse and pen only. A touch is a control input, not a gaze.
    if (event.pointerType === 'touch')
      return

    // A captured mouse has no position; the lens looks where the ship does.
    if (document.pointerLockElement === canvas) {
      hasPointer = false
      return
    }

    if (rectStale) {
      const next  = canvas.getBoundingClientRect()
      rect.left   = next.left
      rect.top    = next.top
      rect.width  = next.width
      rect.height = next.height
      rectStale   = false
    }
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
  window.addEventListener('resize', invalidate, { passive: true })
  window.addEventListener('scroll', invalidate, { passive: true, capture: true })

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
      window.removeEventListener('resize', invalidate)
      window.removeEventListener('scroll', invalidate, { capture: true })
    },
  }
}
