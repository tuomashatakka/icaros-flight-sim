import * as THREE from 'three'
import type { HudPanel } from './panel'
import { HUD_COLORS as COLORS, HUD_FONT as FONT } from './tokens'


/**
 * Attitude, as instruments rather than ornament.
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

/** Vertical speed, m/s. Positive is climbing. */
export function climbRateFrom (velocity: THREE.Vector3): number {
  return velocity.y
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
 * An FPV/airframe pitch ladder: rungs that roll AND translate, labelled.
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
  const accent                                       = options.accent ?? COLORS.blue

  context.save()
  context.beginPath()
  context.rect(x - halfWidth, y - halfHeight, halfWidth * 2, halfHeight * 2)
  context.clip()
  context.translate(x, y)
  context.rotate(-roll / RAD_TO_DEG)

  context.font         = `500 11px ${FONT}`
  context.textBaseline = 'middle'
  context.lineWidth    = 2

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

    context.strokeStyle = zero ? COLORS.white : accent
    context.globalAlpha = zero ? 0.92 : 0.6
    context.setLineDash(angle < 0 ? [ 7, 6 ] : [])

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
      context.fillStyle = accent
      context.textAlign = 'right'
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

/** Arc and pointer across the top of the ladder. The pointer is the horizon's. */
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
  context.lineWidth   = 2

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
  context.fillStyle   = Math.abs(roll) > 45 ? COLORS.amber : COLORS.white
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
  const { context }   = panel
  context.save()
  context.strokeStyle = COLORS.amber
  context.globalAlpha = 0.95
  context.lineWidth   = 3
  context.beginPath()
  context.moveTo(x - arm * 2, y)
  context.lineTo(x - arm, y)
  context.lineTo(x - arm * 0.5, y + arm * 0.5)
  context.lineTo(x, y)
  context.lineTo(x + arm * 0.5, y + arm * 0.5)
  context.lineTo(x + arm, y)
  context.lineTo(x + arm * 2, y)
  context.stroke()
  context.restore()
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
  const { context } = panel
  context.save()
  context.strokeStyle = color
  context.globalAlpha = alpha
  context.lineWidth   = 2
  context.beginPath()
  context.arc(x, y, radius, 0, TAU)
  context.moveTo(x - radius * 2.1, y)
  context.lineTo(x - radius, y)
  context.moveTo(x + radius, y)
  context.lineTo(x + radius * 2.1, y)
  context.moveTo(x, y - radius)
  context.lineTo(x, y - radius * 1.9)
  context.stroke()
  context.restore()
}
