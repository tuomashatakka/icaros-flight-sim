'use client'

import { useEffect, useRef, useState } from 'react'
import { activeControls, setTouchOverlayActive } from '@/engine/input'
import styles from './touch-controls.module.css'


/**
 * `setPointerCapture` throws `NotFoundError` when the id is no longer an active
 * pointer — which happens for real if the finger lifts between the event being
 * queued and the handler running. Capture is an optimisation here, not a
 * requirement, so failing to get it must not take the handler down with it.
 */
function tryCapture (node: Element, pointerId: number) {
  try {
    node.setPointerCapture(pointerId)
  }
  catch {
    // Pointer already gone; the pad still tracks it via pointerId comparison.
  }
}

/** Fraction of the stick radius ignored around centre, so a resting thumb reads as neutral. */
const DEADZONE = 0.16

/** Past this on a stick's Y, throttle or brake latches on. Sticks are analog; those flags are not. */
const AXIS_GATE = 0.32

function useIsTouch (): boolean {
  const [ isTouch, setIsTouch ] = useState(false)

  useEffect(() => {
    // Resolved on the client only: `matchMedia` does not exist during the
    // server render, and guessing from a user-agent string would be wrong for
    // every hybrid laptop.
    const coarse = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0
    const forced = process.env.NODE_ENV !== 'production' &&
      new URLSearchParams(window.location.search).get('touch') === '1'
    setIsTouch(coarse || forced)
  }, [])

  return isTouch
}

type StickApply = (x: number, y: number) => void

/**
 * Bind one analog stick.
 *
 * Everything here is native listeners and direct style writes — no React state
 * on the hot path. A `useState` per pointermove would re-render the whole HUD
 * at thumb rate, which is the exact cost `engine/input.ts` was written to
 * avoid, just moved up a layer.
 */
function useStick (
  padRef: React.RefObject<HTMLDivElement | null>,
  knobRef: React.RefObject<HTMLDivElement | null>,
  apply: StickApply,
  enabled: boolean
) {
  const applyRef   = useRef(apply)
  applyRef.current = apply

  useEffect(() => {
    const pad = padRef.current
    if (!enabled || !pad)
      return

    let pointerId: number | null = null
    let originX                  = 0
    let originY                  = 0
    let radius                   = 1

    const move = (x: number, y: number) => {
      const knob = knobRef.current
      if (knob)
        knob.style.transform = `translate(calc(-50% + ${x * radius}px), calc(-50% + ${y * radius}px))`
      applyRef.current(x, y)
    }

    const onDown = (event: PointerEvent) => {
      if (pointerId !== null)
        return
      pointerId = event.pointerId
      tryCapture(pad, event.pointerId)

      // The stick recentres under the thumb on touch-down rather than using the
      // pad's geometric centre: on a phone you cannot see where your thumb
      // landed, and an absolute stick makes the first input a jerk.
      const rect = pad.getBoundingClientRect()
      radius     = rect.width * 0.34
      originX    = event.clientX
      originY    = event.clientY
      move(0, 0)
      event.preventDefault()
    }

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId)
        return

      let dx = (event.clientX - originX) / radius
      let dy = (event.clientY - originY) / radius
      const len = Math.hypot(dx, dy)
      if (len > 1) {
        dx /= len
        dy /= len
      }
      move(dx, dy)
      event.preventDefault()
    }

    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== pointerId)
        return
      if (pad.hasPointerCapture(event.pointerId))
        pad.releasePointerCapture(event.pointerId)
      pointerId = null
      move(0, 0)
    }

    pad.addEventListener('pointerdown', onDown)
    pad.addEventListener('pointermove', onMove)
    pad.addEventListener('pointerup', onUp)
    pad.addEventListener('pointercancel', onUp)

    return () => {
      pad.removeEventListener('pointerdown', onDown)
      pad.removeEventListener('pointermove', onMove)
      pad.removeEventListener('pointerup', onUp)
      pad.removeEventListener('pointercancel', onUp)
    }
    // `enabled` is load-bearing in this dependency list, not decoration. Touch
    // detection resolves in an effect, so the first render returns null and
    // these refs are empty — and ref objects are stable, so without a changing
    // dep the effect would never re-run once the pads actually mounted. The
    // sticks would render and do nothing at all.
  }, [ padRef, knobRef, enabled ])
}

/** Apply the deadzone and rescale, so the live range still reaches a full 1. */
function shape (value: number): number {
  const magnitude = Math.abs(value)
  if (magnitude < DEADZONE)
    return 0
  return Math.sign(value) * (magnitude - DEADZONE) / (1 - DEADZONE)
}

type HoldButtonProps = {
  label:  string;
  hint?:  string;
  tone?:  'primary' | 'secondary' | 'boost';
  onHold: (down: boolean) => void;
}

/**
 * A press-and-hold button.
 *
 * `pointercancel` matters more than it looks: the browser fires it when a
 * gesture is stolen (a notification, a system edge swipe), and without it the
 * flag latches on and the ship boosts forever.
 */
function HoldButton ({ label, hint, tone = 'primary', onHold }: HoldButtonProps) {
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node)
      return

    const down = (event: PointerEvent) => {
      tryCapture(node, event.pointerId)
      node.dataset.active = 'true'
      onHold(true)
      event.preventDefault()
    }
    const up = () => {
      delete node.dataset.active
      onHold(false)
    }

    node.addEventListener('pointerdown', down)
    node.addEventListener('pointerup', up)
    node.addEventListener('pointercancel', up)
    return () => {
      node.removeEventListener('pointerdown', down)
      node.removeEventListener('pointerup', up)
      node.removeEventListener('pointercancel', up)
      // Never leave a trigger held across an unmount.
      onHold(false)
    }
  }, [ onHold ])

  return <button ref={ ref } type="button" className={ styles[tone] } aria-label={ hint ?? label }>
    { label }
  </button>
}

export type TouchControlsProps = {

  /** Battle adds the two weapon triggers; race has nothing to fire. */
  mode?: 'race' | 'battle';
}

/**
 * On-screen controls for touch devices.
 *
 * Twin sticks, shooter convention: left hand moves the ship, right hand points
 * it. Both write straight into the live `Controls` object through
 * `activeControls()` — the same mutable surface the keyboard writes — so a
 * thumb drag costs no React work at all.
 */
export function TouchControls ({ mode = 'race' }: TouchControlsProps) {
  const isTouch = useIsTouch()

  const movePad  = useRef<HTMLDivElement>(null)
  const moveKnob = useRef<HTMLDivElement>(null)
  const aimPad   = useRef<HTMLDivElement>(null)
  const aimKnob  = useRef<HTMLDivElement>(null)

  // Suppress canvas drag-steering while the sticks are up; otherwise a thumb on
  // open canvas fights the stick for the same axis.
  useEffect(() => {
    if (!isTouch)
      return

    setTouchOverlayActive(true)
    // Stamped on the root rather than letting CSS ask `(pointer: coarse)`
    // itself, so the `?touch=1` dev override hides the keyboard legends too.
    // Two sources of truth for "is this a touch session" is how you end up
    // testing a layout that never ships.
    document.documentElement.dataset.touch = 'true'

    return () => {
      setTouchOverlayActive(false)
      delete document.documentElement.dataset.touch
    }
  }, [ isTouch ])

  useStick(movePad, moveKnob, (x, y) => {
    const controls = activeControls()
    if (!controls)
      return
    controls.strafe = shape(x)

    // Screen Y grows downward; push forward for throttle.
    const forward     = shape(-y)
    controls.throttle = forward > AXIS_GATE
    controls.brake    = forward < -AXIS_GATE
    controls.reverse  = forward < -AXIS_GATE
  }, isTouch)

  useStick(aimPad, aimKnob, (x, y) => {
    const controls = activeControls()
    if (!controls)
      return
    controls.steer = shape(x)
    controls.pitch = shape(-y)
  }, isTouch)

  if (!isTouch)
    return null

  const hold = (key: 'boost' | 'fire' | 'fireSecondary') => (down: boolean) => {
    const controls = activeControls()
    if (controls)
      controls[key] = down
  }

  const bump = (key: 'resetSeq' | 'viewSeq') => () => {
    const controls = activeControls()
    if (controls)
      controls[key]++
  }

  return <div className={ styles.root }>
    <div ref={ movePad } className={ styles.pad } aria-label="Move">
      <span className={ styles.padHint }>MOVE</span>
      <div ref={ moveKnob } className={ styles.knob } />
    </div>

    <div className={ styles.actions }>
      <div className={ styles.chips }>
        <button type="button" className={ styles.chip } onClick={ bump('viewSeq') }>VIEW</button>
        <button type="button" className={ styles.chip } onClick={ bump('resetSeq') }>RESET</button>
      </div>

      <div className={ styles.triggers }>
        { mode === 'battle' && <HoldButton label="MSL" hint="Missile" tone="secondary" onHold={ hold('fireSecondary') } /> }
        { mode === 'battle' && <HoldButton label="FIRE" hint="Beam" tone="primary" onHold={ hold('fire') } /> }
        <HoldButton label="BOOST" tone="boost" onHold={ hold('boost') } />
      </div>
    </div>

    <div ref={ aimPad } className={ styles.pad } aria-label="Aim">
      <span className={ styles.padHint }>AIM</span>
      <div ref={ aimKnob } className={ styles.knob } />
    </div>
  </div>
}
