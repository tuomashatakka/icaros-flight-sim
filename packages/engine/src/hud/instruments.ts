import * as THREE from 'three'
import { glowStroke } from './chrome'
import type { HudPanel } from './panel'
import {
  HUD_FONT_MONO as FONT,
  HUD_HEADING_TAPE_MAJOR_DEG,
  HUD_HEADING_TAPE_MINOR_DEG,
  HUD_SPEED_TAPE_MAJOR_KMH,
  HUD_SPEED_TAPE_MINOR_KMH,
  HUD_THEME as THEME,
} from './tokens'


/**
 * Attitude, speed and heading, as instruments rather than ornament.
 *
 * The old attitude scale drew thirteen rungs at a fixed 34 px pitch that rolled
 * but never translated, carried no angle labels, and took the raw -1/0/+1 R/F
 * key state as its "pitch" — so in race it could only ever be in one of three
 * positions and none of them meant anything. Everything here reads the hull's
 * actual orientation.
 */

const TAU        = Math.PI * 2
const _forward   = new THREE.Vector3()
const _up        = new THREE.Vector3()
const _right     = new THREE.Vector3()
const _euler     = new THREE.Euler()
const WORLD_UP   = new THREE.Vector3(0, 1, 0)
const RAD_TO_DEG = 180 / Math.PI

/** Compass heading, degrees clockwise from +Z. */
export function headingFrom (quaternion: THREE.Quaternion): number {
  _forward.set(0, 0, 1).applyQuaternion(quaternion)
  return (Math.atan2(_forward.x, _forward.z) * RAD_TO_DEG + 360) % 360
}

/**
 * Nose elevation above the horizon, degrees. Positive is nose up.
 *
 * From the forward vector rather than an euler decomposition: an euler's pitch
 * term is only the elevation when roll is zero, and this hull banks hard.
 */
export function pitchFrom (quaternion: THREE.Quaternion): number {
  _forward.set(0, 0, 1).applyQuaternion(quaternion)
  return Math.asin(THREE.MathUtils.clamp(_forward.y, -1, 1)) * RAD_TO_DEG
}

/** Bank angle, degrees. Positive is right wing down. */
export function rollFrom (quaternion: THREE.Quaternion): number {
  return _euler.setFromQuaternion(quaternion, 'YXZ').z * RAD_TO_DEG
}

/** How upright the hull is, 0..1. 1 is level, 0 is on its side or worse. */
export function surfaceAlignment (quaternion: THREE.Quaternion): number {
  return THREE.MathUtils.clamp(_up.set(0, 1, 0).applyQuaternion(quaternion)
    .dot(WORLD_UP), 0, 1)
}

/**
 * Sideslip, -1..1: how much of the velocity is across the hull rather than
 * along it. A hovercraft with no wheels slides, and nothing on the HUD said so.
 */
export function slipFrom (quaternion: THREE.Quaternion, velocity: THREE.Vector3): number {
  const speed = velocity.length()
  if (speed < 0.5)
    return 0
  _right.set(1, 0, 0).applyQuaternion(quaternion)
  return THREE.MathUtils.clamp(-velocity.dot(_right) / speed, -1, 1)
}

/** Signed shortest angular delta from `from` to `to`, degrees, wrapped to ±180. */
function angleDelta (to: number, from: number): number {
  return (to - from + 540) % 360 - 180
}

// --- tabular numerals ----------------------------------------------------------

export type TabularNumberOptions = {
  size?:   number;
  color?:  string;
  align?:  CanvasTextAlign;
  weight?: number;
  glow?:   boolean;
}

/**
 * Fixed-width digit drawing: every digit occupies the widest digit's slot, so a
 * speed readout does not visibly jitter as it rolls from "99" to "100". Only
 * digits are pinned to a slot — punctuation (":", ".", "/") keeps its own
 * natural width, the way a real seven-segment cluster's separators do.
 */
export function drawTabularNumber (
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  options: TabularNumberOptions = {}
): number {
  const size   = options.size ?? 32
  const color  = options.color ?? THEME.pale
  const weight = options.weight ?? 700
  const align  = options.align ?? 'left'

  context.save()
  context.textBaseline = 'middle'
  context.font         = `${weight} ${size}px ${FONT}`

  const digitWidth = context.measureText('0').width
  const widthOf    = (glyph: string) => glyph >= '0' && glyph <= '9' ? digitWidth : context.measureText(glyph).width

  let total = 0
  for (const glyph of value)
    total += widthOf(glyph)

  const start = align === 'right' ? x - total : align === 'center' ? x - total * 0.5 : x

  context.textAlign = 'center'

  if (options.glow) {
    context.font        = `${weight} ${size * 1.12}px ${FONT}`
    context.fillStyle   = color
    context.globalAlpha = 0.22

    let cursor          = start
    for (const glyph of value) {
      const width = widthOf(glyph)
      context.fillText(glyph, cursor + width * 0.5, y)
      cursor += width
    }
    context.font = `${weight} ${size}px ${FONT}`
  }

  context.fillStyle   = color
  context.globalAlpha = 1

  let cursor          = start
  for (const glyph of value) {
    const width = widthOf(glyph)
    context.fillText(glyph, cursor + width * 0.5, y)
    cursor += width
  }
  context.restore()
  return total
}

// --- tape primitives, shared by the speed and heading tapes -------------------

/** One tick, major or minor, at a tape-local x. */
function drawTapeTick (
  context: CanvasRenderingContext2D,
  px: number,
  y: number,
  height: number,
  accent: string,
  isMajor: boolean,
  label: string | null
): void {
  const tickH         = isMajor ? height * 0.62 : height * 0.32
  context.strokeStyle = accent
  context.globalAlpha = isMajor ? 0.7 : 0.36
  context.lineWidth   = isMajor ? 1.6 : 1
  context.beginPath()
  context.moveTo(px, y)
  context.lineTo(px, y + tickH)
  context.stroke()

  if (isMajor && label !== null) {
    context.globalAlpha = 0.65
    context.fillStyle   = accent
    context.fillText(label, px, y + tickH + 2)
  }
}

/** The fixed index at the centre of a tape: a hairline plus a caret above it. */
function drawTapeIndex (
  context: CanvasRenderingContext2D,
  centerX: number,
  y: number,
  height: number,
  accent: string
): void {
  context.save()
  context.strokeStyle = accent
  context.globalAlpha = 0.5
  context.lineWidth   = 1
  context.beginPath()
  context.moveTo(centerX, y)
  context.lineTo(centerX, y + height)
  context.stroke()
  context.fillStyle   = accent
  context.globalAlpha = 0.95
  context.beginPath()
  context.moveTo(centerX, y - 1)
  context.lineTo(centerX - 6, y - 9)
  context.lineTo(centerX + 6, y - 9)
  context.closePath()
  context.fill()
  context.restore()
}

// --- speed tape ------------------------------------------------------------

export type SpeedTapeOptions = {
  x:        number;
  y:        number;
  width:    number;
  height:   number;
  speedKmh: number;
  spanKmh?: number;
  accent?:  string;
}

/**
 * A horizontal tape below the big numerals: minor ticks every 10 km/h, major
 * every 50, the current value fixed under a caret while the tape scrolls past
 * it — the standard "moving scale, fixed index" instrument layout.
 */
export function drawSpeedTape (panel: HudPanel, options: SpeedTapeOptions): void {
  const { context }                       = panel
  const { x, y, width, height, speedKmh } = options
  const accent                            = options.accent ?? THEME.primary
  const span                              = options.spanKmh ?? 140
  const pxPerKmh                          = width / span
  const minor                             = HUD_SPEED_TAPE_MINOR_KMH
  const major                             = HUD_SPEED_TAPE_MAJOR_KMH
  const centerX                           = x + width * 0.5

  context.save()
  context.beginPath()
  context.rect(x, y, width, height)
  context.clip()

  const first = Math.ceil((speedKmh - span * 0.5) / minor) * minor
  const last  = speedKmh + span * 0.5

  context.font         = `500 10px ${FONT}`
  context.textAlign    = 'center'
  context.textBaseline = 'top'
  for (let value = Math.max(0, first); value <= last; value += minor) {
    const isMajor = Math.round(value) % major === 0
    const px      = centerX + (value - speedKmh) * pxPerKmh
    drawTapeTick(context, px, y, height, accent, isMajor, isMajor ? String(Math.round(value)) : null)
  }
  context.restore()

  // Fixed caret and hairline index — the tape moves, this does not.
  drawTapeIndex(context, centerX, y, height, accent)
}

// --- heading tape ------------------------------------------------------------

const CARDINALS: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }

export type HeadingTapeOptions = {
  x:        number;
  y:        number;
  width:    number;
  height:   number;
  heading:  number;
  spanDeg?: number;
  accent?:  string;

  /** Absolute bearing to the next gate/target. Drawn as a cyan caret when set. */
  bearingToTarget?: number | null;
}

/**
 * A top-centre compass tape: ticks every 15°, cardinal labels every 45°, and
 * — in race — the bearing to the next gate as a cyan caret sharing the same
 * scale, so "how far off course" reads at a glance.
 */
export function drawHeadingTape (panel: HudPanel, options: HeadingTapeOptions): void {
  const { context }                      = panel
  const { x, y, width, height, heading } = options
  const accent                           = options.accent ?? THEME.primary
  const span                             = options.spanDeg ?? 120
  const pxPerDeg                         = width / span
  const minor                            = HUD_HEADING_TAPE_MINOR_DEG
  const major                            = HUD_HEADING_TAPE_MAJOR_DEG
  const centerX                          = x + width * 0.5

  context.save()
  context.beginPath()
  context.rect(x, y, width, height)
  context.clip()

  const halfSpan = span * 0.5
  const first    = Math.ceil((heading - halfSpan) / minor) * minor

  context.font         = `500 10px ${FONT}`
  context.textAlign    = 'center'
  context.textBaseline = 'top'
  for (let raw = first; raw <= heading + halfSpan; raw += minor) {
    const norm    = (raw % 360 + 360) % 360
    const isMajor = Math.round(norm) % major === 0
    const px      = centerX + angleDelta(raw, heading) * pxPerDeg
    drawTapeTick(context, px, y, height, accent, isMajor, isMajor ? CARDINALS[norm] ?? String(norm) : null)
  }

  drawBearingCaret(context, options.bearingToTarget ?? null, heading, halfSpan, centerX, pxPerDeg, y, height)
  context.restore()

  drawTapeIndex(context, centerX, y, height, accent)
}

/** A cyan caret below the tape at a target's bearing — only if it is in view. */
function drawBearingCaret (
  context: CanvasRenderingContext2D,
  bearing: number | null,
  heading: number,
  halfSpan: number,
  centerX: number,
  pxPerDeg: number,
  y: number,
  height: number
): void {
  if (bearing === null)
    return

  const delta = angleDelta(bearing, heading)
  if (Math.abs(delta) > halfSpan)
    return

  const px            = centerX + delta * pxPerDeg
  context.fillStyle   = THEME.accent
  context.globalAlpha = 0.95
  context.beginPath()
  context.moveTo(px, y + height)
  context.lineTo(px - 6, y + height + 8)
  context.lineTo(px + 6, y + height + 8)
  context.closePath()
  context.fill()
}

export type PitchLadderOptions = {

  /** Panel-space centre of the instrument. */
  x: number;
  y: number;

  /** Half-width and half-height of the visible window, panel px. */
  halfWidth:  number;
  halfHeight: number;

  /** Degrees, from `pitchFrom` / `rollFrom`. */
  pitch: number;
  roll:  number;

  /** Vertical panel pixels per degree of pitch. */
  pixelsPerDegree?: number;

  /** Rung spacing, degrees. */
  step?: number;

  accent?: string;
}

/**
 * An FPV/airframe pitch ladder: thin rungs that roll AND translate, labelled.
 *
 * The rungs move opposite the nose, so climbing drives the horizon down the
 * window — the standard convention, and the one that makes the instrument
 * readable without thinking about it. Below the horizon the rungs are dashed
 * and their ends point up toward it, which is how you tell sky from ground at a
 * glance when the hull is inverted.
 */
export function drawPitchLadder (panel: HudPanel, options: PitchLadderOptions): void {
  const { context }                                  = panel
  const { x, y, halfWidth, halfHeight, pitch, roll } = options
  const perDegree                                    = options.pixelsPerDegree ?? 3.2
  const step                                         = options.step ?? 10
  const accent                                       = options.accent ?? THEME.primary

  drawHorizonBar(panel, x + halfWidth + 34, y, 22, halfHeight, pitch, accent)

  context.save()
  context.beginPath()
  context.rect(x - halfWidth, y - halfHeight, halfWidth * 2, halfHeight * 2)
  context.clip()
  context.translate(x, y)
  context.rotate(-roll / RAD_TO_DEG)

  context.font         = `500 11px ${FONT}`
  context.textBaseline = 'middle'
  context.lineWidth    = 1.2

  // One rung either side of the window, so a rung scrolling in is already drawn
  // rather than popping into existence at the clip edge.
  const span  = Math.ceil((halfHeight / perDegree + step) / step) * step
  const first = Math.round((pitch - span) / step) * step

  for (let angle = first; angle <= pitch + span; angle += step) {
    if (angle > 90 || angle < -90)
      continue

    const rungY = (angle - pitch) * perDegree
    const zero  = angle === 0
    const arm   = zero ? halfWidth * 0.92 : halfWidth * (Math.abs(angle) % (step * 2) === 0 ? 0.62 : 0.34)
    const gap   = zero ? halfWidth * 0.16 : halfWidth * 0.1
    const tick  = angle < 0 ? -7 : 7

    context.strokeStyle = zero ? THEME.bright : accent
    context.globalAlpha = zero ? 0.95 : 0.55
    context.setLineDash(angle < 0 ? [ 6, 5 ] : [])

    context.beginPath()
    context.moveTo(-arm, rungY)
    context.lineTo(-gap, rungY)
    context.moveTo(gap, rungY)
    context.lineTo(arm, rungY)
    if (!zero) {
      // End caps point back toward the horizon, so "which way is up" survives
      // an inverted hull.
      context.moveTo(-arm, rungY)
      context.lineTo(-arm, rungY + tick)
      context.moveTo(arm, rungY)
      context.lineTo(arm, rungY + tick)
    }
    context.stroke()

    if (!zero && Math.abs(angle) % (step * 2) === 0) {
      context.fillStyle   = accent
      context.globalAlpha = 0.7
      context.textAlign   = 'right'
      context.fillText(String(Math.abs(angle)), -arm - 6, rungY)
      context.textAlign = 'left'
      context.fillText(String(Math.abs(angle)), arm + 6, rungY)
    }
  }

  context.setLineDash([])
  context.restore()

  drawBankScale(panel, x, y - halfHeight + 6, halfHeight * 0.86, roll, accent)
  drawBoresight(panel, x, y, halfWidth * 0.2)
}

/**
 * A small artificial-horizon icon: a sky/ground split that rotates with roll
 * and slides with pitch — the compact glance instrument beside the full ladder.
 */
function drawHorizonBar (
  panel: HudPanel,
  x: number,
  y: number,
  size: number,
  halfHeight: number,
  pitch: number,
  accent: string
): void {
  const { context } = panel
  const height      = Math.min(size * 2.4, halfHeight * 1.5)
  const rect        = { x: x - size * 0.5, y: y - height * 0.5, width: size, height }

  context.save()
  context.beginPath()
  context.rect(rect.x, rect.y, rect.width, rect.height)
  context.clip()

  const split         = rect.y + rect.height * 0.5 + THREE.MathUtils.clamp(pitch, -45, 45) * (rect.height / 90)
  context.fillStyle   = THEME.dimmer
  context.globalAlpha = 1
  context.fillRect(rect.x, rect.y, rect.width, Math.max(0, split - rect.y))
  context.fillStyle   = accent
  context.globalAlpha = 0.22
  context.fillRect(rect.x, split, rect.width, rect.height - (split - rect.y))
  context.strokeStyle = accent
  context.globalAlpha = 0.85
  context.lineWidth   = 1.5
  context.beginPath()
  context.moveTo(rect.x, split)
  context.lineTo(rect.x + rect.width, split)
  context.stroke()
  context.restore()

  context.save()
  context.strokeStyle = THEME.dim
  context.globalAlpha = 0.7
  context.lineWidth   = 1
  context.strokeRect(rect.x, rect.y, rect.width, rect.height)
  context.restore()
}

/** Arc and pointer across the top of the ladder — a roll indicator, not a dial. */
function drawBankScale (
  panel: HudPanel,
  x: number,
  y: number,
  radius: number,
  roll: number,
  accent: string
): void {
  const { context } = panel
  context.save()
  context.translate(x, y + radius)
  context.strokeStyle = accent
  context.globalAlpha = 0.45
  context.lineWidth   = 1.6

  for (const angle of [ -45, -30, -15, 0, 15, 30, 45 ]) {
    const a    = (angle - 90) / RAD_TO_DEG
    const long = angle === 0 || Math.abs(angle) === 30
    context.beginPath()
    context.moveTo(Math.cos(a) * radius, Math.sin(a) * radius)
    context.lineTo(Math.cos(a) * (radius + (long ? 11 : 6)), Math.sin(a) * (radius + (long ? 11 : 6)))
    context.stroke()
  }

  const pointer       = (THREE.MathUtils.clamp(roll, -60, 60) - 90) / RAD_TO_DEG
  context.globalAlpha = 0.95
  context.fillStyle   = Math.abs(roll) > 45 ? THEME.red : THEME.bright
  context.beginPath()
  context.moveTo(Math.cos(pointer) * radius, Math.sin(pointer) * radius)
  context.lineTo(Math.cos(pointer + 0.05) * (radius - 12), Math.sin(pointer + 0.05) * (radius - 12))
  context.lineTo(Math.cos(pointer - 0.05) * (radius - 12), Math.sin(pointer - 0.05) * (radius - 12))
  context.closePath()
  context.fill()
  context.restore()
}

/** The fixed airframe symbol the ladder moves behind. */
function drawBoresight (panel: HudPanel, x: number, y: number, arm: number): void {
  glowStroke(panel.context, context => {
    context.moveTo(x - arm * 2, y)
    context.lineTo(x - arm, y)
    context.lineTo(x - arm * 0.5, y + arm * 0.5)
    context.lineTo(x, y)
    context.lineTo(x + arm * 0.5, y + arm * 0.5)
    context.lineTo(x + arm, y)
    context.lineTo(x + arm * 2, y)
  }, THEME.bright, 2, 0.95)
}

/** A small ring-and-wings marker: where the ship is actually going, not pointing. */
export function drawFlightPathMarker (
  panel: HudPanel,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha = 0.9
): void {
  glowStroke(panel.context, context => {
    context.arc(x, y, radius, 0, TAU)
    context.moveTo(x - radius * 2.1, y)
    context.lineTo(x - radius, y)
    context.moveTo(x + radius, y)
    context.lineTo(x + radius * 2.1, y)
    context.moveTo(x, y - radius)
    context.lineTo(x, y - radius * 1.9)
  }, color, 1.6, alpha)
}
