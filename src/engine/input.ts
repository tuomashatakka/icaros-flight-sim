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
   * Weapon triggers. Meaningless in race, which simply never reads them.
   *
   * They live here rather than in `battle.ts` — where they were two closure
   * variables bound to keydown — because a control surface with three input
   * paths (keys, mouse buttons, touch) needs one place they all agree on. A
   * touch button cannot reach a closure.
   */
  fire:          boolean;
  fireSecondary: boolean;

  /**
   * -1 (aim down, F) .. 1 (aim up, R). Held, not edge-counted.
   *
   * Deliberately a raw axis rather than an angle: race eases it back to level
   * because it is a *look*, battle integrates it into a trim that stays put
   * because it is an *aim*. Baking either policy in here would deny the other.
   */
  pitch: number;

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
    steer:         0,
    throttle:      false,
    brake:         false,
    boost:         false,
    reverse:       false,
    strafe:        0,
    pitch:         0,
    fire:          false,
    fireSecondary: false,
    resetSeq:      0,
    viewSeq:       0,
    panX:          0,
    panY:          0,
  }
}

const isLeft     = (key: string) => key === 'ArrowLeft' || key.toLowerCase() === 'q'
const isRight    = (key: string) => key === 'ArrowRight' || key.toLowerCase() === 'e'
const isThrottle = (key: string) => key === 'ArrowUp' || key.toLowerCase() === 'w'
const isBrake    = (key: string) => key === 'ArrowDown' || key.toLowerCase() === 's'
const clampSteer = (value: number) => Math.max(-1, Math.min(1, value))

/**
 * Wire keyboard + pointer input into `controls`.
 *
 * @param target - The canvas; it is the drag surface and gets pointer capture.
 * @returns A detach function — call it from the app's dispose chain.
 */
/**
 * The control surface of the scene currently mounted, or null.
 *
 * A deliberate module-level handle rather than a store. The on-screen touch
 * controls are DOM that lives outside the scene, and they have to write the
 * same mutable object the keyboard writes — routing them through zustand is
 * exactly the pattern this module's header describes tearing out, because it
 * re-renders the tree on every thumb movement.
 */
let active: Controls | null = null

export function activeControls (): Controls | null {
  return active
}

/**
 * True while the on-screen sticks are mounted.
 *
 * Canvas drag-steering and a virtual stick both want the same finger, so the
 * pointer path ignores touch input while the sticks are up. Mouse and pen still
 * work, which is what keeps the overlay testable on a desktop.
 */
let touchOverlay = false

export function setTouchOverlayActive (value: boolean): void {
  touchOverlay = value
}

export function attachControls (target: HTMLElement, controls: Controls): () => void {
  active = controls

  const pressed       = new Set<'left' | 'right'>()
  const strafePressed = new Set<'strafeLeft' | 'strafeRight'>()
  const pitchPressed  = new Set<'pitchUp' | 'pitchDown'>()
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

  const refreshPitch = () => {
    const up       = pitchPressed.has('pitchUp')
    const down     = pitchPressed.has('pitchDown')
    controls.pitch = up === down ? 0 : up ? 1 : -1
  }

  /**
   * True while the keystroke belongs to a form field.
   *
   * These listeners are on `window`, so without this every letter typed into a
   * field also drives the ship — and Space, which now calls `preventDefault` to
   * stop the page scrolling mid-fight, could not be typed at all.
   */
  const isEditing = (event: KeyboardEvent) => {
    const node = event.target as HTMLElement | null
    if (!node)
      return false

    const tag = node.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (isEditing(event))
      return

    const k = event.key.toLowerCase()
    if (isLeft(event.key)) {
      pressed.add('left')
      refreshKeyboardSteer()
    }
    else if (isRight(event.key)) {
      pressed.add('right')
      refreshKeyboardSteer()
    }

    if (k === 'a') {
      strafePressed.add('strafeLeft')
      refreshStrafe()
    }
    else if (k === 'd') {
      strafePressed.add('strafeRight')
      refreshStrafe()
    }

    if (k === 'r') {
      pitchPressed.add('pitchUp')
      refreshPitch()
    }
    else if (k === 'f') {
      pitchPressed.add('pitchDown')
      refreshPitch()
    }

    if (event.code === 'Space') {
      // The page scrolls on Space otherwise, and a scrolled canvas puts the
      // whole HUD off screen mid-fight.
      event.preventDefault()
      controls.fire = true
    }
    else if (k === 'x')
      controls.fireSecondary = true

    if (isThrottle(event.key))
      controls.throttle = true
    else if (isBrake(event.key)) {
      controls.brake   = true
      controls.reverse = true
    }
    else if (event.key === 'Shift')
      controls.boost = true
    else if (event.key === 'Backspace' && !event.repeat) {
      // Backspace is the browser's back gesture on some platforms; respawning
      // must not navigate out of the race.
      event.preventDefault()
      controls.resetSeq++
    }
    else if (k === 'c' && !event.repeat)
      controls.viewSeq++
  }

  const onKeyUp = (event: KeyboardEvent) => {
    if (isEditing(event))
      return

    const k = event.key.toLowerCase()
    if (isLeft(event.key)) {
      pressed.delete('left')
      refreshKeyboardSteer()
    }
    else if (isRight(event.key)) {
      pressed.delete('right')
      refreshKeyboardSteer()
    }

    if (k === 'a') {
      strafePressed.delete('strafeLeft')
      refreshStrafe()
    }
    else if (k === 'd') {
      strafePressed.delete('strafeRight')
      refreshStrafe()
    }

    if (k === 'r') {
      pitchPressed.delete('pitchUp')
      refreshPitch()
    }
    else if (k === 'f') {
      pitchPressed.delete('pitchDown')
      refreshPitch()
    }

    if (event.code === 'Space')
      controls.fire = false
    else if (k === 'x')
      controls.fireSecondary = false

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
    pitchPressed.clear()
    keyboardSteer = 0
    pointerSteer = 0
    controls.throttle      = false
    controls.brake         = false
    controls.boost         = false
    controls.reverse       = false
    controls.strafe        = 0
    controls.pitch         = 0
    controls.fire          = false
    controls.fireSecondary = false
    controls.steer         = 0
    controls.panX          = 0
    controls.panY          = 0
  }

  // Drag steering is ABSOLUTE from the press point and recenters on release,
  // which is why this stays hand-rolled instead of using the library's
  // `attachPointerGesture` — that reports incremental deltas and has no
  // pointer-up hook, so it can't express recenter-on-release.
  let pointerId: number | null = null
  let pointerStartX            = 0

  const onPointerDown = (event: PointerEvent) => {
    if (pointerId !== null || touchOverlay && event.pointerType === 'touch')
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
    if (active === controls)
      active = null
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
