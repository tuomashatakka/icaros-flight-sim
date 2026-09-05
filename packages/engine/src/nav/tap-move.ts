import * as THREE from 'three'
import type { Controls } from '../input'
import { HUD_HUES } from '../hud/tokens'
import { steerToward, tapGroundPoint } from './steering'


/**
 * Tap the ground, fly there.
 *
 * A fallback control path, not a replacement for the sticks: on a phone the
 * canvas drag gesture is look-around and the virtual sticks own thrust, so if
 * the touch rail fails to paint for any reason there is no way to move at all —
 * `setTouchOverlayActive` has already told `input.ts` to drop touch
 * drag-steering by then. This closes that hole with the one gesture that needs
 * no on-screen furniture to discover.
 *
 * It writes the same `Controls` a thumb would and reaches nothing else. The sim
 * cannot tell a tap from a key, so determinism and the replay harnesses are
 * untouched.
 */

/** How close counts as arrived, world units. Roughly two ship lengths. */
const ARRIVE_RADIUS = 6

/**
 * How far a touch may travel and still be a tap, CSS pixels.
 *
 * Above this it is the look-around drag the gesture layer already owns. A thumb
 * never holds perfectly still, so zero would mean no taps ever register.
 */
const TAP_SLOP = 12

/** How long a touch may last and still be a tap, ms. */
const TAP_TIME = 350

export type TapMoveDeps = {
  canvas:   HTMLCanvasElement;
  controls: Controls;

  /** The live camera. Read per tap rather than captured — the rig may swap it. */
  camera(): THREE.Camera | null;

  /** Interpolated render pose of the ship. */
  shipPosition(): THREE.Vector3;
  hullQuaternion(): THREE.Quaternion;

  /**
   * Whether a pointer of this kind may drive the ship.
   *
   * Touch only by default. A mouse already has the keyboard and canvas
   * drag-steering, and a stray click stealing the throttle would be worse than
   * the problem this solves.
   */
  accepts(pointerType: string): boolean;

  /** Where to hang the target marker. */
  scene: THREE.Scene;
}

export type TapMove = {

  /** Fold the current goal into `Controls`. Call once per rendered frame. */
  drive(): void;

  /** Drop the goal and release the axes it was holding. */
  clear(): void;
  dispose(): void;
}

type PendingTap = {
  x:    number;
  y:    number;
  time: number;
}

type TargetMarker = THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>

/** A flat ring on the ground, so a tap is visibly acknowledged. */
function createMarker (): TargetMarker {
  const geometry = new THREE.RingGeometry(1.4, 2.1, 32)
  geometry.rotateX(-Math.PI * 0.5)

  const material = new THREE.MeshBasicMaterial({
    color:       new THREE.Color(HUD_HUES.cyan),
    transparent: true,
    opacity:     0.85,
    depthWrite:  false,
    side:        THREE.DoubleSide,
    toneMapped:  false,
  })

  const mesh         = new THREE.Mesh(geometry, material)
  mesh.name          = 'tap-move-target'
  mesh.visible       = false
  mesh.frustumCulled = false
  return mesh
}

export function attachTapMove (deps: TapMoveDeps): TapMove {
  const { canvas, controls, scene } = deps

  const goal   = new THREE.Vector3()
  const marker = createMarker()
  scene.add(marker)

  let hasGoal                    = false
  let pending: PendingTap | null = null

  /** True while this module is the one holding the axes, so it only releases its own. */
  let driving = false

  function clear (): void {
    hasGoal        = false
    marker.visible = false
    if (driving) {
      driving               = false
      controls.steer        = 0
      controls.throttle     = false
      controls.throttleAxis = 0
    }
  }

  const onPointerDown = (event: PointerEvent) => {
    if (!deps.accepts(event.pointerType))
      return
    pending = { x: event.clientX, y: event.clientY, time: event.timeStamp }
  }

  const onPointerUp = (event: PointerEvent) => {
    const start = pending
    pending     = null
    if (!start || !deps.accepts(event.pointerType))
      return

    // A drag is the gesture layer's look-around, not a destination.
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y)
    if (moved > TAP_SLOP || event.timeStamp - start.time > TAP_TIME)
      return

    const camera = deps.camera()
    if (!camera)
      return

    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0)
      return

    const ndcX = (event.clientX - rect.left) / rect.width * 2 - 1
    const ndcY = -((event.clientY - rect.top) / rect.height * 2 - 1)

    if (!tapGroundPoint(camera, ndcX, ndcY, deps.shipPosition().y, goal))
      return

    hasGoal        = true
    marker.visible = true
    marker.position.copy(goal)
  }

  // A cancelled or lost pointer is not a tap. Without this a touch that slides
  // off the canvas mid-gesture leaves `pending` set and the NEXT release, on the
  // other side of the screen, reads as a tap from the old start point.
  const onPointerCancel = () => {
    pending = null
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerCancel)
  canvas.addEventListener('pointerleave', onPointerCancel)

  return {
    drive () {
      if (!hasGoal)
        return

      const command = steerToward(
        deps.shipPosition(),
        deps.hullQuaternion(),
        goal,
        ARRIVE_RADIUS
      )

      if (command.arrived) {
        clear()
        return
      }

      driving               = true
      controls.steer        = command.steer
      controls.throttle     = command.throttle
      controls.throttleAxis = command.throttle ? 1 : 0

      // The marker sits on the ground the ship is at, not the ground it was
      // tapped from — a hovercraft that has climbed since the tap would
      // otherwise leave the ring buried or floating.
      marker.position.y = deps.shipPosition().y + 0.05
    },

    clear,

    dispose () {
      clear()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerCancel)
      canvas.removeEventListener('pointerleave', onPointerCancel)
      scene.remove(marker)
      marker.geometry.dispose()
      marker.material.dispose()
    },
  }
}
