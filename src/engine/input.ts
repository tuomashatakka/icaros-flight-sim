/**
 * Live control surface, read directly in the sim tick.
 *
 * Deliberately a plain mutable object rather than a store: the old
 * `use-mobile.tsx` routed every keystroke and pointermove through zustand, and
 * the vehicle component consumed it as a React value — so dragging to steer
 * re-rendered the scene at pointer-move rate. Nothing here touches React.
 */
export type Controls = {

  /** -1 (left) .. 1 (right). The vehicle owns the yaw sign convention. */
  steer: number;

  /** W / Up arrow. The ship does not accelerate on its own. */
  throttle: boolean;

  /** S / Down arrow. Brakes the ship. */
  brake: boolean;
  boost: boolean;

  /**
   * Monotonic respawn counter, NOT a boolean.
   *
   * The sim runs 0..MAX_SUB_STEPS times per real frame, so a held key read as a
   * boolean fires its action on every tick inside one press — a latent bug in
   * the old `controls.reset`, masked only by respawn being idempotent. Consumers
   * compare against a last-seen value, which is edge-correct at any tick rate.
   */
  resetSeq: number;
}

export function createControls (): Controls {
  return { steer: 0, throttle: false, brake: false, boost: false, resetSeq: 0 }
}

const isLeft     = (key: string) => key === 'ArrowLeft' || key.toLowerCase() === 'a'
const isRight    = (key: string) => key === 'ArrowRight' || key.toLowerCase() === 'd'
const isThrottle = (key: string) => key === 'ArrowUp' || key.toLowerCase() === 'w'
const isBrake    = (key: string) => key === 'ArrowDown' || key.toLowerCase() === 's'
const clampSteer = (value: number) => Math.max(-1, Math.min(1, value))

/**
 * Wire keyboard + pointer input into `controls`.
 *
 * @param target - The canvas; it is the drag surface and gets pointer capture.
 * @returns A detach function — call it from the app's dispose chain.
 */
export function attachControls (target: HTMLElement, controls: Controls): () => void {
  const pressed = new Set<'left' | 'right'>()
  let keyboardSteer = 0
  let pointerSteer  = 0

  const syncSteer = () => {
    // Keyboard wins while held; pointer is the fallback.
    controls.steer = keyboardSteer || pointerSteer
  }

  const refreshKeyboardSteer = () => {
    const left  = pressed.has('left')
    const right = pressed.has('right')
    keyboardSteer = left === right ? 0 : right ? 1 : -1
    syncSteer()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (isLeft(event.key)) {
      pressed.add('left')
      refreshKeyboardSteer()
    }
    else if (isRight(event.key)) {
      pressed.add('right')
      refreshKeyboardSteer()
    }
    else if (isThrottle(event.key))
      controls.throttle = true
    else if (isBrake(event.key))
      controls.brake = true
    else if (event.key === 'Shift')
      controls.boost = true
    else if (event.key.toLowerCase() === 'r' && !event.repeat)
      controls.resetSeq++
  }

  const onKeyUp = (event: KeyboardEvent) => {
    if (isLeft(event.key)) {
      pressed.delete('left')
      refreshKeyboardSteer()
    }
    else if (isRight(event.key)) {
      pressed.delete('right')
      refreshKeyboardSteer()
    }
    else if (isThrottle(event.key))
      controls.throttle = false
    else if (isBrake(event.key))
      controls.brake = false
    else if (event.key === 'Shift')
      controls.boost = false
  }

  // Losing focus mid-turn would otherwise leave the ship steering forever.
  const onBlur = () => {
    pressed.clear()
    keyboardSteer = 0
    pointerSteer = 0
    controls.throttle = false
    controls.brake    = false
    controls.boost    = false
    controls.steer    = 0
  }

  // Drag steering is ABSOLUTE from the press point and recenters on release,
  // which is why this stays hand-rolled instead of using the library's
  // `attachPointerGesture` — that reports incremental deltas and has no
  // pointer-up hook, so it can't express recenter-on-release.
  let pointerId: number | null = null
  let pointerStartX            = 0

  const onPointerDown = (event: PointerEvent) => {
    if (pointerId !== null)
      return
    pointerId = event.pointerId
    pointerStartX = event.clientX
    pointerSteer = 0
    target.setPointerCapture(event.pointerId)
    syncSteer()
  }

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId)
      return

    const steeringWidth = Math.max(target.clientWidth * 0.32, 120)
    pointerSteer = clampSteer((event.clientX - pointerStartX) / steeringWidth)
    syncSteer()
  }

  const endPointer = (event: PointerEvent) => {
    if (event.pointerId !== pointerId)
      return
    if (target.hasPointerCapture(event.pointerId))
      target.releasePointerCapture(event.pointerId)
    pointerId = null
    pointerSteer = 0
    syncSteer()
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  target.addEventListener('pointerdown', onPointerDown)
  target.addEventListener('pointermove', onPointerMove)
  target.addEventListener('pointerup', endPointer)
  target.addEventListener('pointercancel', endPointer)

  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    target.removeEventListener('pointerdown', onPointerDown)
    target.removeEventListener('pointermove', onPointerMove)
    target.removeEventListener('pointerup', endPointer)
    target.removeEventListener('pointercancel', endPointer)
  }
}
