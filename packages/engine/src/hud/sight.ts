import * as THREE from 'three'
import { TEAM_COLORS } from 'Ψarena'
import { WEAPONS } from 'Ψweapons'
import { drawTrackedText, glowStroke, glowText } from './chrome'
import { drawFlightPathMarker, drawPitchLadder, pitchFrom, rollFrom, slipFrom } from './instruments'
import type { HudPanel } from './panel'
import { HUD_FONT_MONO as FONT, HUD_THEME as THEME } from './tokens'
import type { HudData, HudFrame } from './types'


/**
 * The sight: the one part of the HUD that has to sit at a real screen position.
 *
 * It draws on the OVERLAY plane, not on a visor facet. The facets are a folded
 * surface in the world that now rides the hull in chase view, so a mark placed
 * on one is at a place in the cockpit, not a place on the screen — fine for a
 * gauge, useless for a reticle. The overlay is already camera-locked and
 * exactly fills the frustum, so `camera.project` maps a world point onto it
 * with no extra machinery, and the existing hit-test coordinate space still
 * applies.
 *
 * Race gets an attitude reference, because there is nothing to shoot: an FPV
 * ladder with a flight-path marker showing where the hull is actually going as
 * opposed to where it is pointing. Battle gets a gun sight: a pipper on the
 * real aim vector and a second mark where the shot is predicted to land.
 */

const TAU        = Math.PI * 2
const _projected = new THREE.Vector3()
const _view      = new THREE.Vector3()
const _velocity  = new THREE.Vector3()
const _muzzle    = new THREE.Vector2()

type ScreenPoint = { x: number; y: number; visible: boolean }

const _aimPoint: ScreenPoint    = { x: 0, y: 0, visible: false }
const _impactPoint: ScreenPoint = { x: 0, y: 0, visible: false }
const _pathPoint: ScreenPoint   = { x: 0, y: 0, visible: false }

/**
 * World point to overlay-canvas pixels.
 *
 * `camera.project` alone is not enough: behind the camera the perspective
 * divide flips the sign and a point at your back comes back as a plausible
 * on-screen position. The view-space depth test is what rejects it.
 */
function project (
  out: ScreenPoint,
  panel: HudPanel,
  camera: THREE.Camera,
  point: THREE.Vector3
): ScreenPoint {
  _view.copy(point).applyMatrix4(camera.matrixWorldInverse)
  if (_view.z > -0.01) {
    out.visible = false
    return out
  }

  _projected.copy(point).project(camera)
  out.x       = (_projected.x * 0.5 + 0.5) * panel.canvas.width
  out.y       = (0.5 - _projected.y * 0.5) * panel.canvas.height
  out.visible = true
  return out
}

/** Keep a marker on screen with an edge arrow rather than letting it vanish. */
function clampToFrame (point: ScreenPoint, panel: HudPanel, inset: number): void {
  point.x = THREE.MathUtils.clamp(point.x, inset, panel.canvas.width - inset)
  point.y = THREE.MathUtils.clamp(point.y, inset, panel.canvas.height - inset)
}

export function drawHudSight (overlay: HudPanel, data: HudData, frame: HudFrame): void {
  if (data.mode === 'battle')
    drawGunSight(overlay, data.battle, frame)
  else
    drawFlightSight(overlay, frame)
}

/** Race: an attitude reference, sized to the frame rather than to a panel. */
function drawFlightSight (overlay: HudPanel, frame: HudFrame): void {
  const { context, canvas } = overlay
  const unit                = Math.min(canvas.width, canvas.height)
  const x                   = canvas.width * 0.5
  const y                   = canvas.height * 0.5
  const pitch               = pitchFrom(frame.hullQuaternion)
  const roll                = rollFrom(frame.hullQuaternion)

  drawPitchLadder(overlay, {
    x,
    y,
    halfWidth:       unit * 0.24,
    halfHeight:      unit * 0.19,
    pitch,
    roll,
    pixelsPerDegree: unit * 0.0075,
    accent:          THEME.amber,
  })

  // Where the hull is actually going. On a craft with this much sideslip the
  // gap between the boresight and this marker IS the handling readout.
  _velocity.copy(frame.telemetry.velocity)
  if (_velocity.lengthSq() > 4) {
    _velocity.normalize().multiplyScalar(60)
      .add(frame.shipPosition)
    project(_pathPoint, overlay, frame.camera, _velocity)
    if (_pathPoint.visible) {
      clampToFrame(_pathPoint, overlay, unit * 0.05)
      drawFlightPathMarker(overlay, _pathPoint.x, _pathPoint.y, unit * 0.018, THEME.cyan)
    }
  }

  const slip = slipFrom(frame.hullQuaternion, frame.telemetry.velocity)
  context.save()
  context.strokeStyle = Math.abs(slip) > 0.35 ? THEME.red : THEME.amber
  context.globalAlpha = 0.7
  context.lineWidth   = 2

  const slipY = y + unit * 0.215
  const slipX = x + slip * unit * 0.1
  context.strokeRect(slipX - unit * 0.014, slipY, unit * 0.028, unit * 0.012)
  context.globalAlpha = 0.3
  context.beginPath()
  context.moveTo(x - unit * 0.11, slipY + unit * 0.016)
  context.lineTo(x + unit * 0.11, slipY + unit * 0.016)
  context.stroke()
  context.restore()

  overlayLabel(overlay, `${Math.round(pitch)}° PITCH · ${Math.round(roll)}° BANK · ${frame.telemetry.gLoad.toFixed(1)}G`, x, y + unit * 0.25, THEME.amber)
}

/** Battle: a gun sight on the real aim vector, plus where the shot lands. */
function drawGunSight (overlay: HudPanel, battle: Extract<HudData, { mode: 'battle' }>['battle'], frame: HudFrame): void {
  const { context, canvas } = overlay
  const unit                = Math.min(canvas.width, canvas.height)
  const sight               = frame.sight
  const lock                = battle.lockOn
  const locked              = lock.phase === 'locked'
  const tracking            = lock.phase === 'tracking'
  const color               = locked ? THEME.green : tracking ? THEME.amber : THEME.pale

  drawKillFeed(overlay, battle, unit)

  if (!sight)
    return

  _projected.copy(sight.direction).multiplyScalar(Math.min(sight.range, 400))
    .add(sight.origin)
  project(_aimPoint, overlay, frame.camera, _projected)
  if (!_aimPoint.visible)
    return

  // Convergence: the pods the hull actually carries, drawn onto the point the
  // ray says the shot reaches. The sim fires from one synthetic muzzle on the
  // centreline, so these lines are the only honest picture of where the visible
  // guns are looking.
  if (sight.hardpoints.length > 0) {
    context.save()
    context.strokeStyle = color
    context.globalAlpha = 0.16
    context.lineWidth   = 1.4
    context.beginPath()
    for (const hardpoint of sight.hardpoints) {
      project(_impactPoint, overlay, frame.camera, hardpoint)
      if (!_impactPoint.visible)
        continue
      _muzzle.set(_impactPoint.x, _impactPoint.y)
      context.moveTo(_muzzle.x, _muzzle.y)
      context.lineTo(_aimPoint.x, _aimPoint.y)
    }
    context.stroke()
    context.restore()
  }

  drawPipper(overlay, _aimPoint.x, _aimPoint.y, unit * 0.026, color, sight.onTarget)

  if (tracking)
    drawAcquiringRing(overlay, _aimPoint.x, _aimPoint.y, unit * 0.05, frame.elapsed, lock.progress, color)
  else if (locked) {
    drawLockRing(overlay, _aimPoint.x, _aimPoint.y, unit * 0.05, color)
    drawConvergingCorners(overlay, _aimPoint.x, _aimPoint.y, unit * 0.078, color)
  }

  // The impact mark. Separate from the pipper because they only coincide when
  // the shot reaches its full reach unobstructed — the gap between them is the
  // arena getting in the way.
  if (sight.impact) {
    project(_impactPoint, overlay, frame.camera, sight.impact)
    if (_impactPoint.visible) {
      drawImpactMark(overlay, _impactPoint.x, _impactPoint.y, unit * 0.02, sight.onTarget ? THEME.red : THEME.cyan)

      const gap = Math.hypot(_impactPoint.x - _aimPoint.x, _impactPoint.y - _aimPoint.y)
      if (gap > unit * 0.03) {
        context.save()
        context.strokeStyle = THEME.cyan
        context.globalAlpha = 0.34
        context.setLineDash([ 5, 5 ])
        context.lineWidth = 1.5
        context.beginPath()
        context.moveTo(_aimPoint.x, _aimPoint.y)
        context.lineTo(_impactPoint.x, _impactPoint.y)
        context.stroke()
        context.restore()
      }
    }
  }

  const weapon = battle.primary ? WEAPONS[battle.primary.id].label.toUpperCase() : 'NO WEAPON'
  const label  = locked
    ? `${lock.name?.toUpperCase() ?? 'TARGET'} · LOCK · ${lock.distance} M`
    : `${weapon} · ${Number.isFinite(sight.range) ? `${Math.round(sight.range)} M` : 'FREE VECTOR'}`
  overlayLabel(overlay, label, _aimPoint.x, _aimPoint.y + unit * 0.085, color)
}

/** Four gapped arms and a centre dot. Fills in when the ray is on a hull. */
function drawPipper (
  overlay: HudPanel,
  x: number,
  y: number,
  radius: number,
  color: string,
  onTarget: boolean
): void {
  glowStroke(overlay.context, context => {
    for (const [ dx, dy ] of [[ -1, 0 ], [ 1, 0 ], [ 0, -1 ], [ 0, 1 ]] as Array<[number, number]>) {
      context.moveTo(x + dx * radius * 0.55, y + dy * radius * 0.55)
      context.lineTo(x + dx * radius * 1.8, y + dy * radius * 1.8)
    }
    context.arc(x, y, radius, 0, TAU)
  }, color, 2, 0.9)

  if (onTarget) {
    const { context } = overlay
    context.save()
    context.globalAlpha = 0.85
    context.fillStyle   = color
    context.beginPath()
    context.arc(x, y, radius * 0.35, 0, TAU)
    context.fill()
    context.restore()
  }
}

/** A ring of dashes that spins while a lock is being acquired. */
function drawAcquiringRing (
  overlay: HudPanel,
  x: number,
  y: number,
  radius: number,
  elapsed: number,
  progress: number,
  color: string
): void {
  const { context } = overlay
  const dashCount   = 18
  const step        = TAU / dashCount
  const dashLength  = step * 0.5

  context.save()
  context.translate(x, y)
  context.rotate(elapsed * 1.4)
  context.strokeStyle = color
  context.lineWidth   = 2.4
  context.globalAlpha = 0.85
  context.setLineDash([ radius * dashLength, radius * (step - dashLength) ])
  context.beginPath()
  context.arc(0, 0, radius, 0, TAU)
  context.stroke()
  context.setLineDash([])
  context.restore()

  // The filled arc underneath is how much of the acquisition is actually done —
  // the spin alone would never say "how close".
  context.save()
  context.strokeStyle = color
  context.globalAlpha = 0.95
  context.lineWidth   = 3
  context.beginPath()
  context.arc(x, y, radius * 0.82, -Math.PI * 0.5, -Math.PI * 0.5 + TAU * THREE.MathUtils.clamp(progress, 0, 1))
  context.stroke()
  context.restore()
}

/** A solid ring — the dashes snap shut the instant the lock completes. */
function drawLockRing (overlay: HudPanel, x: number, y: number, radius: number, color: string): void {
  glowStroke(overlay.context, context => context.arc(x, y, radius, 0, TAU), color, 2.6, 0.95)
}

/** Four corner marks converging on the pipper — the locked-on confirmation. */
function drawConvergingCorners (overlay: HudPanel, x: number, y: number, size: number, color: string): void {
  const inner = size * 0.62
  const arm   = size * 0.3
  glowStroke(overlay.context, context => {
    for (const [ sx, sy ] of [[ -1, -1 ], [ 1, -1 ], [ 1, 1 ], [ -1, 1 ]] as Array<[number, number]>) {
      const cx = x + sx * inner
      const cy = y + sy * inner
      context.moveTo(cx - sx * arm, cy)
      context.lineTo(cx, cy)
      context.lineTo(cx, cy - sy * arm)
    }
  }, color, 2, 0.9)
}

/** A diamond at the ray-marched collision point. */
function drawImpactMark (overlay: HudPanel, x: number, y: number, radius: number, color: string): void {
  glowStroke(overlay.context, context => {
    context.moveTo(x, y - radius)
    context.lineTo(x + radius, y)
    context.lineTo(x, y + radius)
    context.lineTo(x - radius, y)
    context.closePath()
  }, color, 1.6, 0.85)
}

function drawKillFeed (
  overlay: HudPanel,
  battle: Extract<HudData, { mode: 'battle' }>['battle'],
  unit: number
): void {
  const { context, canvas } = overlay
  context.save()
  battle.killFeed.slice(0, 3).forEach((entry, index) => {
    const size          = Math.max(10, unit * 0.019)
    const y             = unit * 0.08 + index * unit * 0.035
    const right         = canvas.width - unit * 0.04
    const color         = entry.team ? TEAM_COLORS[entry.team] : THEME.pale
    context.globalAlpha = 0.78 - index * 0.14
    drawTrackedText(
      context,
      `${entry.killer} / ${entry.weapon ? WEAPONS[entry.weapon].label : 'RAM'} / ${entry.victim}`,
      right,
      y,
      { size, color, align: 'right', tracking: 0.6, weight: 500 }
    )
    context.strokeStyle = color
    context.globalAlpha = 0.4
    context.lineWidth   = 1
    context.beginPath()
    context.moveTo(right + 6, y - size * 0.7)
    context.lineTo(right + 6, y + size * 0.7)
    context.stroke()
  })
  context.restore()
}

/** A bracketed readout — the sight's own status line. */
function overlayLabel (overlay: HudPanel, value: string, x: number, y: number, color: string): void {
  const { canvas } = overlay
  const unit       = Math.min(canvas.width, canvas.height)
  glowText(overlay.context, `[ ${value} ]`, x, y, color, Math.max(10, unit * 0.021), 'center', 500, FONT)
}
