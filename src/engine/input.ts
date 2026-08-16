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
  brake:   boolean;
  boost:   boolean;
  reverse: boolean;
  strafe:  number;

  /**
   * Monotonic respawn counter, NOT a boolean.
   *
   * The sim runs 0..MAX_SUB_STEPS times per real frame, so a held key read as a
   * boolean fires its action on every tick inside one press — a latent bug in
   * the old `controls.reset`, masked only by respawn being idempotent. Consumers
   * compare against a last-seen value, which is edge-correct at any tick rate.
   */
  resetSeq: number;

  /** Chase <-> cockpit toggle. Edge-counted for the same reason as `resetSeq`. */
  viewSeq: number;

  /**
   * Look-around pan, -1..1 on each axis, from pointer HOVER — not drag, which
   * already steers. Consumed by the camera rig, which eases toward it.
   */
  panX: number;
  panY: number;
}

export function createControls (): Controls {
  return {
    steer:    0,
    throttle: false,
    brake:    false,
    boost:    false,
    reverse:  false,
    strafe:   0,
    resetSeq: 0,
    viewSeq:  0,
    panX:     0,
    panY:     0,
  }
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
  const pressed       = new Set<'left' | 'right'>()
  const strafePressed = new Set<'strafeLeft' | 'strafeRight'>()
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

  const refreshStrafe = () => {
    const sLeft     = strafePressed.has('strafeLeft')
    const sRight    = strafePressed.has('strafeRight')
    controls.strafe = sLeft === sRight ? 0 : sRight ? -1 : 1
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const k = event.key.toLowerCase()
    if (isLeft(event.key)) {
      pressed.add('left')
      refreshKeyboardSteer()
    }
    else if (isRight(event.key)) {
      pressed.add('right')
      refreshKeyboardSteer()
    }

    if (k === 'q') {
      strafePressed.add('strafeLeft')
      refreshStrafe()
    }
    else if (k === 'e') {
      strafePressed.add('strafeRight')
      refreshStrafe()
    }

    if (isThrottle(event.key))
      controls.throttle = true
    else if (isBrake(event.key)) {
      controls.brake   = true
      controls.reverse = true
    }
    else if (event.key === 'Shift')
      controls.boost = true
    else if (k === 'r' && !event.repeat)
      controls.resetSeq++
    else if (k === 'c' && !event.repeat)
      controls.viewSeq++
  }

  const onKeyUp = (event: KeyboardEvent) => {
    const k = event.key.toLowerCase()
    if (isLeft(event.key)) {
      pressed.delete('left')
      refreshKeyboardSteer()
    }
    else if (isRight(event.key)) {
      pressed.delete('right')
      refreshKeyboardSteer()
    }

    if (k === 'q') {
      strafePressed.delete('strafeLeft')
      refreshStrafe()
    }
    else if (k === 'e') {
      strafePressed.delete('strafeRight')
      refreshStrafe()
    }

    if (isThrottle(event.key))
      controls.throttle = false
    else if (isBrake(event.key)) {
      controls.brake   = false
      controls.reverse = false
    }
    else if (event.key === 'Shift')
      controls.boost = false
  }

  // Losing focus mid-turn would otherwise leave the ship steering forever.
  const onBlur = () => {
    pressed.clear()
    strafePressed.clear()
    keyboardSteer = 0
    pointerSteer = 0
    controls.throttle = false
    controls.brake    = false
    controls.boost    = false
    controls.reverse  = false
    controls.strafe   = 0
    controls.steer    = 0
    controls.panX     = 0
    controls.panY     = 0
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

  // Panning rides HOVER rather than drag, because drag is already steering. The
  // two never contend: while a drag is active the pan is left frozen at
  // whatever it was, so looking around cannot fight a turn mid-corner.
  const onPointerMove = (event: PointerEvent) => {
    if (pointerId === null) {
      const rect = target.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        controls.panX = clampSteer((event.clientX - rect.left) / rect.width * 2 - 1)
        controls.panY = clampSteer((event.clientY - rect.top) / rect.height * 2 - 1)
      }
      return
    }

    if (event.pointerId !== pointerId)
      return

    const steeringWidth = Math.max(target.clientWidth * 0.32, 120)
    pointerSteer = clampSteer((event.clientX - pointerStartX) / steeringWidth)
    syncSteer()
  }

  // Ease back to neutral rather than freezing at the last edge position.
  const onPointerLeave = () => {
    controls.panX = 0
    controls.panY = 0
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
  target.addEventListener('pointerleave', onPointerLeave)

  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    target.removeEventListener('pointerdown', onPointerDown)
    target.removeEventListener('pointermove', onPointerMove)
    target.removeEventListener('pointerup', endPointer)
    target.removeEventListener('pointercancel', endPointer)
    target.removeEventListener('pointerleave', onPointerLeave)
  }
}
