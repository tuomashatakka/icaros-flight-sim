/**
 * Gestures made by fingers that did NOT land on a control.
 *
 * The HUD's pointer handling was already per-pointer, but `onPointerDown`
 * returned early whenever a press missed a region — so every finger on empty
 * canvas was discarded and touch had no look-around and no pinch at all. (It
 * had a look-around by accident: the press was dropped, `input.ts` then saw the
 * MOVE as a hover because its own pointer id was still null, and since touch
 * fires no `pointerleave` the camera stayed yawed after the finger lifted.)
 *
 * Free pointers are tracked here instead. One is a look-around; two are a
 * pinch. Nothing in this file knows about regions, controls or the camera — it
 * reports two numbers and the caller decides what they mean.
 */

export type TouchGestureSample = {

  /** Look-around, -1..1 per axis. */
  panX: number;
  panY: number;

  /** Absolute view blend while pinching, 0..1, or null when not pinching. */
  blend: number | null;
}

export type TouchGestureOptions = {

  /** Full look-around deflection, CSS pixels. */
  panRadius(): number;

  /** Pinch distance, CSS pixels, for a full chase-to-cockpit sweep. */
  pinchRange(): number;

  /** The blend a pinch starts from, so it is relative rather than absolute. */
  currentBlend(): number;
}

export type TouchGestures = {
  down(id: number, x: number, y: number): void;
  move(id: number, x: number, y: number): void;
  up(id: number): void;
  clear(): void;

  /** True while at least one free pointer is down. */
  readonly active: boolean;

  /** Current gesture state. Reused; copy anything you keep. */
  sample(): TouchGestureSample;
}

type FreePointer = {
  startX: number;
  startY: number;
  x:      number;
  y:      number;
}

const clamp1 = (value: number) => Math.max(-1, Math.min(1, value))

export function createTouchGestures (options: TouchGestureOptions): TouchGestures {
  const pointers                   = new Map<number, FreePointer>()
  const result: TouchGestureSample = { panX: 0, panY: 0, blend: null }

  /** Finger distance and starting blend at the moment the second finger landed. */
  let pinchStartDistance = 0
  let pinchStartBlend    = 0

  function distance (): number {
    const [ a, b ] = [ ...pointers.values() ]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  function beginPinch (): void {
    pinchStartDistance = distance()
    pinchStartBlend    = options.currentBlend()
  }

  return {
    get active () {
      return pointers.size > 0
    },

    down (id, x, y) {
      pointers.set(id, { startX: x, startY: y, x, y })
      if (pointers.size === 2)
        beginPinch()
    },

    move (id, x, y) {
      const pointer = pointers.get(id)
      if (!pointer)
        return
      pointer.x = x
      pointer.y = y
    },

    up (id) {
      if (!pointers.delete(id))
        return
      // Dropping to one finger restarts the pinch from where it is, rather than
      // snapping as the surviving finger's distance is measured against a pair
      // that no longer exists.
      if (pointers.size === 2)
        beginPinch()
    },

    clear () {
      pointers.clear()
    },

    sample () {
      result.panX  = 0
      result.panY  = 0
      result.blend = null

      if (pointers.size === 1) {
        const [ pointer ] = [ ...pointers.values() ]
        const radius      = Math.max(1, options.panRadius())
        result.panX       = clamp1((pointer.x - pointer.startX) / radius)
        result.panY       = clamp1((pointer.y - pointer.startY) / radius)
        return result
      }

      if (pointers.size >= 2) {
        // Pinching in seats you, spreading pulls the camera back out — the
        // gesture matches what happens to the ship on screen, not to the blend
        // parameter, which is the one people actually predict.
        const travel = (pinchStartDistance - distance()) / Math.max(1, options.pinchRange())
        result.blend = Math.max(0, Math.min(1, pinchStartBlend + travel))
      }

      return result
    },
  }
}
