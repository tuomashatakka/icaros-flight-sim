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

  /**
   * Commanded thrust, 0..1. Display and touch only — the sim reads `throttle`.
   *
   * A key is on or off, so for the keyboard this is just `throttle` as a number
   * and the HUD reads the same thing it always did. A thumb on a stick is not,
   * and the propulsion gauge was showing a hardcoded 0 / 0.72 / 1 because there
   * was nowhere for an analog command to live. Deliberately NOT fed to
   * `stepHovercraft`: that would change how the ship accelerates, and handling
   * authority is `packages/physics`, not the input layer.
   */
  throttleAxis: number;

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
   * Absolute chase <-> cockpit blend, 0..1, applied when `viewBlendSeq` moves.
   *
   * A pinch names a position, not a direction, so it cannot go through
   * `viewSeq`. The counter is still what makes it edge-correct across the sim's
   * variable substep count.
   */
  viewBlend:    number;
  viewBlendSeq: number;

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
    throttleAxis:  0,
    brake:         false,
    boost:         false,
    reverse:       false,
    strafe:        0,
    pitch:         0,
    fire:          false,
    fireSecondary: false,
    resetSeq:      0,
    viewSeq:       0,
    viewBlend:     0,
    viewBlendSeq:  0,
    panX:          0,
    panY:          0,
  }
}

// A/D turn and Q/E strafe. It was the other way round for a while, which put
//  the primary lateral pair on the secondary control — and because strafe was
//  then mostly a yaw AWAY from the key, A/D read as a turn the wrong way.
const isLeft     = (key: string) => key === 'ArrowLeft' || key.toLowerCase() === 'a'
const isRight    = (key: string) => key === 'ArrowRight' || key.toLowerCase() === 'd'
const isStrafeL  = (key: string) => key.toLowerCase() === 'q'
const isStrafeR  = (key: string) => key.toLowerCase() === 'e'
const isThrottle = (key: string) => key === 'ArrowUp' || key.toLowerCase() === 'w'
const isBrake    = (key: string) => key === 'ArrowDown' || key.toLowerCase() === 's'
const clampSteer = (value: number) => Math.max(-1, Math.min(1, value))

/**
 * The control surface of the scene currently mounted, or null.
 *
 * A deliberate module-level handle rather than a store. Battle mouse triggers
 * and the canvas-owned HUD have to write the same mutable object as the
 * keyboard — routing either through zustand would re-render React on every
 * pointer or thumb movement.
 */
let active: Controls | null = null

export function activeControls (): Controls | null {
  return active
}

/**
 * True while the canvas HUD exposes on-screen sticks.
 *
 * Canvas drag-steering and a virtual stick both want the same finger, so the
 * pointer path ignores touch input while the sticks are up. Mouse and pen still
 * work, which is what keeps the overlay testable on a desktop.
 */
let touchOverlay = false

export function setTouchOverlayActive (value: boolean): void {
  touchOverlay = value
}

/**
 * Mouse steering, while the pointer is captured.
 *
 * Movement is a RATE, not a position: each pixel adds to a steer axis that
 * bleeds back to centre on its own, so moving the mouse turns the ship and
 * stopping stops the turn — the same thing mouse-look does to a camera, which
 * is what a hand already expects. An absolute "virtual stick" needs the mouse
 * walked back to a centre nobody can see once the cursor is hidden.
 */
const MOUSE_STEER_PER_PX    = 0.004
const MOUSE_STEER_HALF_LIFE = 0.12

/**
 * The camera's share of the same movement: a small lead into the turn, and a
 * vertical glance. Scaled well inside the pan limits — a nudge, not a look.
 */
const MOUSE_NUDGE_PER_PX    = 0.006
const MOUSE_NUDGE_HALF_LIFE = 0.3
const MOUSE_NUDGE_SCALE     = 0.45

export type ControlOptions = {

  /** Capture the mouse on a click into the canvas. */
  pointerLock: boolean;

  /** Multiplier on mouse steering and nudge. */
  sensitivity: number;
  invertY:     boolean;
}

export type AttachedControls = {
  detach(): void;

  /** Decay the mouse axes. Once per RENDERED frame, with the real delta. */
  tick(dt: number): void;
  configure(options: Partial<ControlOptions>): void;

  /** True while the canvas holds the pointer. */
  readonly locked: boolean;
}

/**
 * Wire keyboard, mouse and pointer input into `controls`.
 *
 * @param target - The canvas: the drag surface, and what captures the mouse.
 * @returns The detach function for the app's dispose chain, and the per-frame
 * tick the mouse axes decay on.
 */
export function attachControls (
  target: HTMLElement,
  controls: Controls,
  initial: Partial<ControlOptions> = {}
): AttachedControls {
  active = controls

  const options: ControlOptions = { pointerLock: true, sensitivity: 1, invertY: false, ...initial }

  const pressed       = new Set<'left' | 'right'>()
  const strafePressed = new Set<'strafeLeft' | 'strafeRight'>()
  const pitchPressed  = new Set<'pitchUp' | 'pitchDown'>()
  let keyboardSteer = 0
  let pointerSteer  = 0
  let mouseSteer    = 0
  let nudgeX        = 0
  let nudgeY        = 0
  let locked        = false

  const syncSteer = () => {
    // Keyboard wins while held; the captured mouse, then a drag, are fallbacks.
    controls.steer = keyboardSteer || mouseSteer || pointerSteer
  }

  const clearMouse = () => {
    mouseSteer    = 0
    nudgeX        = 0
    nudgeY        = 0
    controls.panX = 0
    controls.panY = 0
    syncSteer()
  }

  const onLockChange = () => {
    const now = document.pointerLockElement === target
    if (now === locked)
      return
    locked = now
    clearMouse()
  }

  const requestLock = () => {
    if (!options.pointerLock || locked || typeof target.requestPointerLock !== 'function')
      return
    try {
      // Raw deltas where the browser offers them: OS acceleration on a
      // steering axis makes the same flick turn a different amount each time.
      const request = (target.requestPointerLock as (options?: { unadjustedMovement?: boolean }) => Promise<void> | void)
        .call(target, { unadjustedMovement: true })
      if (request && typeof (request as Promise<void>).catch === 'function')
        (request as Promise<void>).catch(() => {
          // Refused: no raw-input support, or the browser's cooldown after an
          // Esc. The plain request covers the first; the next click, the second.
          try {
            const fallback = target.requestPointerLock() as unknown as Promise<void> | void
            if (fallback && typeof (fallback as Promise<void>).catch === 'function')
              (fallback as Promise<void>).catch(() => {})
          }
          catch {
            // Nothing to do; the drag and hover paths still work unlocked.
          }
        })
    }
    catch {
      // Older engines throw synchronously on the options bag.
    }
  }

  const refreshKeyboardSteer = () => {
    const left  = pressed.has('left')
    const right = pressed.has('right')
    keyboardSteer = left === right ? 0 : right ? 1 : -1
    syncSteer()
  }

  const refreshStrafe = () => {
    const sLeft  = strafePressed.has('strafeLeft')
    const sRight = strafePressed.has('strafeRight')
    // Same sense as steer: positive is to the pilot's right.
    controls.strafe = sLeft === sRight ? 0 : sRight ? 1 : -1
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

    if (isStrafeL(event.key)) {
      strafePressed.add('strafeLeft')
      refreshStrafe()
    }
    else if (isStrafeR(event.key)) {
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

    if (isThrottle(event.key)) {
      controls.throttle     = true
      controls.throttleAxis = 1
    }
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

    if (isStrafeL(event.key)) {
      strafePressed.delete('strafeLeft')
      refreshStrafe()
    }
    else if (isStrafeR(event.key)) {
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

    if (isThrottle(event.key)) {
      controls.throttle     = false
      controls.throttleAxis = 0
    }
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
    mouseSteer   = 0
    nudgeX       = 0
    nudgeY       = 0
    controls.throttle      = false
    controls.throttleAxis  = 0
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
    // Captured, a click is a click — battle's triggers read it — not a drag.
    if (locked)
      return

    // A plain click into the canvas takes the mouse. Anything the HUD claimed
    // never gets here: its handler stops propagation on a hit.
    if (event.pointerType === 'mouse' && event.button === 0 && options.pointerLock) {
      requestLock()
      return
    }

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
    if (locked) {
      const gain = options.sensitivity
      mouseSteer = clampSteer(mouseSteer + event.movementX * MOUSE_STEER_PER_PX * gain)
      nudgeX     = clampSteer(nudgeX + event.movementX * MOUSE_NUDGE_PER_PX * gain)
      nudgeY     = clampSteer(nudgeY + event.movementY * MOUSE_NUDGE_PER_PX * gain * (options.invertY ? -1 : 1))
      controls.panX = nudgeX * MOUSE_NUDGE_SCALE
      controls.panY = nudgeY * MOUSE_NUDGE_SCALE
      syncSteer()
      return
    }

    // The overlay owns every touch pointer when its controls are up, including
    // the ones that miss a control. Without this the drop in `onPointerDown`
    // leaves `pointerId` null and a finger dragged on empty canvas falls into
    // the HOVER branch below — which then never recentres, because touch fires
    // no `pointerleave`, so the camera stays yawed after the finger lifts.
    if (touchOverlay && event.pointerType === 'touch')
      return

    if (pointerId === null) {
      // `offsetX/Y` are already relative to the canvas, which spares a
      // `getBoundingClientRect` — a forced layout — at the mouse's report rate.
      const width  = target.clientWidth
      const height = target.clientHeight
      if (width > 0 && height > 0) {
        controls.panX = clampSteer(event.offsetX / width * 2 - 1)
        controls.panY = clampSteer(event.offsetY / height * 2 - 1)
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
    if (locked)
      return
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
  document.addEventListener('pointerlockchange', onLockChange)
  target.addEventListener('pointerdown', onPointerDown)
  target.addEventListener('pointermove', onPointerMove)
  target.addEventListener('pointerup', endPointer)
  target.addEventListener('pointercancel', endPointer)
  target.addEventListener('pointerleave', onPointerLeave)

  const detach = () => {
    if (active === controls)
      active = null
    if (locked && document.pointerLockElement === target)
      document.exitPointerLock()
    document.removeEventListener('pointerlockchange', onLockChange)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
    target.removeEventListener('pointerdown', onPointerDown)
    target.removeEventListener('pointermove', onPointerMove)
    target.removeEventListener('pointerup', endPointer)
    target.removeEventListener('pointercancel', endPointer)
    target.removeEventListener('pointerleave', onPointerLeave)
  }

  return {
    detach,

    tick (dt) {
      if (!locked || mouseSteer === 0 && nudgeX === 0 && nudgeY === 0)
        return

      mouseSteer *= Math.pow(2, -dt / MOUSE_STEER_HALF_LIFE)
      nudgeX     *= Math.pow(2, -dt / MOUSE_NUDGE_HALF_LIFE)
      nudgeY     *= Math.pow(2, -dt / MOUSE_NUDGE_HALF_LIFE)
      if (Math.abs(mouseSteer) < 1e-3)
        mouseSteer = 0
      if (Math.abs(nudgeX) < 1e-3 && Math.abs(nudgeY) < 1e-3)
        nudgeX = nudgeY = 0
      controls.panX = nudgeX * MOUSE_NUDGE_SCALE
      controls.panY = nudgeY * MOUSE_NUDGE_SCALE
      syncSteer()
    },

    configure (next) {
      Object.assign(options, next)
      if (!options.pointerLock && locked && document.pointerLockElement === target)
        document.exitPointerLock()
    },

    get locked () {
      return locked
    },
  }
}
