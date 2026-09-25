import * as THREE from 'three'
import { TEAM_COLORS } from 'Ψarena'
import { WEAPONS } from 'Ψweapons'
import { drawTrackedText, glowStroke, glowText } from './chrome'
import { drawFlightPathMarker, drawPitchLadder, pitchFrom, rollFrom, slipFrom } from './instruments'
import { HudPanel } from './panel'
import { HUD_FONT_MONO as FONT, HUD_HUES as HUES, HUD_THEME as THEME } from './tokens'
import type { BattleHudData, HudData, HudFrame } from './types'


/**
 * The sight: the part of the HUD that has to sit at a real screen position.
 *
 * It used to be painted into the full-screen OVERLAY raster, which is
 * re-rasterised at the HUD's repaint budget (15-30 Hz) while the camera moves
 * every frame. So the pipper was drawn where the aim point WAS when the sheet
 * last repainted, then carried along with the camera for the next two to four
 * frames — at speed, or through a turn, it trailed the thing it was marking by
 * tens of pixels and snapped back on each repaint. That is the "the target
 * pointer's position is off": not a wrong projection, a stale one. It also
 * read `camera.matrixWorldInverse` before the renderer had refreshed it, a
 * whole frame behind the pose the rig had just set, and aimed from the
 * predicted BODY rather than the pose the ship is drawn at.
 *
 * Now every mark is its own small quad, positioned EVERY rendered frame from
 * the camera as it is this frame. A quad's raster only changes when what it
 * shows does (a lock phase, a colour, a range readout); where it is costs a
 * matrix multiply. The placement is exact without a projection matrix: a world
 * point's view-space ray is scaled onto a fixed depth in front of the eye, so
 * the quad sits on the very ray the point does and three draws it there.
 *
 * Race gets an attitude reference, because there is nothing to shoot: an FPV
 * ladder with a flight-path marker showing where the hull is actually going as
 * opposed to where it is pointing. Battle gets a gun sight: a pipper on the
 * real aim vector and a second mark where the shot is predicted to land.
 */

const TAU = Math.PI * 2

/** Where the marks hang, world units from the eye. Inside the overlay plane (4.35). */
const SIGHT_DEPTH = 4

/** How far down the aim ray the pipper is drawn when nothing is in reach. */
const AIM_REACH = 400

const _view     = new THREE.Vector3()
const _point    = new THREE.Vector3()
const _velocity = new THREE.Vector3()

type Mark = {
  panel:    HudPanel;
  mesh:     THREE.Mesh;
  material: THREE.MeshBasicMaterial;

  /** Canvas pixels per `unit` (the frame's short edge) — how big the raster is drawn. */
  pxPerUnit: number;
  key:       string;
  paintedAt: number;
}

function createMark (name: string, width: number, height: number, pxPerUnit: number, quad: THREE.PlaneGeometry): Mark {
  const panel    = new HudPanel({ name, width, height, center: true })
  const material = new THREE.MeshBasicMaterial({
    map:         panel.texture,
    transparent: true,
    depthTest:   false,
    depthWrite:  false,
    // Drawn after the composer, like the rest of the HUD: see `hud/materials.ts`.
    toneMapped:  true,
  })
  const mesh         = new THREE.Mesh(quad, material)
  mesh.name          = `hud-sight-${name}`
  mesh.renderOrder   = 1003
  mesh.frustumCulled = false
  mesh.visible       = false
  mesh.raycast       = () => {}
  return { panel, mesh, material, pxPerUnit, key: '', paintedAt: -Infinity }
}

/**
 * Redraw a mark's raster only when what it shows changed — and, for the one
 * mark whose content moves continuously, no faster than `period` seconds.
 */
function paint (
  mark: Mark,
  key: string,
  draw: (panel: HudPanel, cx: number, cy: number, unit: number) => void,
  elapsed = 0,
  period = 0
): void {
  if (mark.key === key || elapsed - mark.paintedAt < period)
    return
  mark.key       = key
  mark.paintedAt = elapsed

  const { context, canvas } = mark.panel
  context.clearRect(0, 0, canvas.width, canvas.height)
  draw(mark.panel, canvas.width * 0.5, canvas.height * 0.5, mark.pxPerUnit)
  mark.panel.texture.needsUpdate = true
}

export type SightLayer = {
  object: THREE.Group;

  /** Every rendered frame, after the camera has been posed. */
  update(data: HudData, frame: HudFrame, aspect: number): void;
  dispose(): void;
}

export function createSightLayer (): SightLayer {
  const quad   = new THREE.PlaneGeometry(1, 1)
  const object = new THREE.Group()
  object.name  = 'spatial-cockpit-hud-sight'

  const pipper  = createMark('pipper', 256, 256, 256 / 0.24, quad)
  const spinner = createMark('spinner', 160, 160, 160 / 0.12, quad)
  const impact  = createMark('impact', 64, 64, 64 / 0.06, quad)
  const label   = createMark('label', 640, 64, 640 / 0.9, quad)
  const ladder  = createMark('ladder', 700, 560, 700 / 0.62, quad)
  const path    = createMark('path', 96, 96, 96 / 0.1, quad)
  const marks   = [ pipper, spinner, impact, label, ladder, path ]
  for (const mark of marks)
    object.add(mark.mesh)

  // Convergence from the drawn gun pods onto the aim point, and the gap from
  // the aim point to where the shot actually lands. World-space lines, so they
  // are exactly the lines the 2D sight used to draw — and a frame fresher.
  const lineGeometry  = new THREE.BufferGeometry()
  const linePositions = new Float32Array(8 * 2 * 3)
  lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3))

  const lineMaterial  = new THREE.LineBasicMaterial({ color: THEME.pale, transparent: true, opacity: 0.18, depthTest: false, depthWrite: false })
  const lines         = new THREE.LineSegments(lineGeometry, lineMaterial)
  lines.renderOrder   = 1002
  lines.frustumCulled = false
  lines.raycast       = () => {}
  object.add(lines)

  let tanHalf   = 0.36
  let aspectNow = 16 / 9
  let unitWorld = 1

  /**
   * Put `mesh` on the view ray through `world`, at `SIGHT_DEPTH`.
   *
   * @returns False when the point is behind the eye — the perspective divide
   * would otherwise hand back a plausible position for something at your back.
   */
  function onRay (camera: THREE.Camera, world: THREE.Vector3, out: THREE.Vector3): boolean {
    _view.copy(world).applyMatrix4(camera.matrixWorldInverse)
    if (_view.z > -0.01)
      return false

    const k = SIGHT_DEPTH / -_view.z
    out.set(_view.x * k, _view.y * k, -SIGHT_DEPTH)
    return true
  }

  /** Clamp a camera-local mark into the frame, `inset` units in from the edge. */
  function clampToFrame (local: THREE.Vector3, inset: number): void {
    const halfH = SIGHT_DEPTH * tanHalf
    const halfW = halfH * aspectNow
    const pad   = inset * unitWorld
    local.x     = THREE.MathUtils.clamp(local.x, -halfW + pad, halfW - pad)
    local.y     = THREE.MathUtils.clamp(local.y, -halfH + pad, halfH - pad)
  }

  function show (mark: Mark, local: THREE.Vector3, offsetUnitsY = 0): void {
    const { canvas } = mark.panel
    mark.mesh.position.set(local.x, local.y - offsetUnitsY * unitWorld, local.z)
    mark.mesh.scale.set(canvas.width / mark.pxPerUnit * unitWorld, canvas.height / mark.pxPerUnit * unitWorld, 1)
    mark.mesh.visible = true
  }

  const _aim      = new THREE.Vector3()
  const _hit      = new THREE.Vector3()
  const _pod      = new THREE.Vector3()
  const _aimLocal = new THREE.Vector3()

  function gunSight (battle: BattleHudData['battle'], frame: HudFrame): void {
    const sight   = frame.sight
    lines.visible = false
    if (!sight)
      return

    _aim.copy(sight.direction).multiplyScalar(Math.min(sight.range, AIM_REACH))
      .add(sight.origin)
    if (!onRay(frame.camera, _aim, _aimLocal))
      return

    const lock     = battle.lockOn
    const locked   = lock.phase === 'locked'
    const tracking = lock.phase === 'tracking'
    const color    = locked ? THEME.green : tracking ? THEME.accent : THEME.pale

    paint(pipper, `${color}|${sight.onTarget}|${lock.phase}|${tracking ? Math.round(lock.progress * 50) : 0}`, (panel, cx, cy, unit) => {
      drawPipper(panel, cx, cy, unit * 0.026, color, sight.onTarget)
      if (tracking)
        drawAcquiringArc(panel, cx, cy, unit * 0.05, lock.progress, color)
      else if (locked) {
        drawLockRing(panel, cx, cy, unit * 0.05, color)
        drawConvergingCorners(panel, cx, cy, unit * 0.078, color)
      }
    })
    show(pipper, _aimLocal)

    // The dashes spin while a lock is being acquired; the quad turns, the
    // raster does not.
    if (tracking) {
      paint(spinner, color, (panel, cx, cy, unit) => drawDashRing(panel, cx, cy, unit * 0.05, color))
      show(spinner, _aimLocal)
      spinner.mesh.rotation.z = -frame.elapsed * 1.4
    }

    const weapon = battle.primary ? WEAPONS[battle.primary.id].label.toUpperCase() : 'NO WEAPON'
    const text   = locked
      ? `${lock.name?.toUpperCase() ?? 'TARGET'} · LOCK · ${lock.distance} M`
      : `${weapon} · ${Number.isFinite(sight.range) ? `${Math.round(sight.range)} M` : 'FREE VECTOR'}`
    paint(label, `${text}|${color}`, (panel, cx, cy, unit) => overlayLabel(panel, text, cx, cy, color, unit))
    show(label, _aimLocal, 0.085)

    // Convergence lines: pod -> aim point, in world space, so the renderer
    // projects them with the same camera as everything else.
    let segments = 0
    for (const hardpoint of sight.hardpoints) {
      if (segments >= 7 || !onRay(frame.camera, hardpoint, _pod))
        continue
      _pod.toArray(linePositions, segments * 6)
      _aimLocal.toArray(linePositions, segments * 6 + 3)
      segments++
    }

    if (sight.impact && onRay(frame.camera, sight.impact, _hit)) {
      const impactColor = sight.onTarget ? THEME.red : THEME.primary
      paint(impact, impactColor, (panel, cx, cy, unit) => drawImpactMark(panel, cx, cy, unit * 0.02, impactColor))
      show(impact, _hit)

      if (_hit.distanceTo(_aimLocal) > unitWorld * 0.03) {
        _aimLocal.toArray(linePositions, segments * 6)
        _hit.toArray(linePositions, segments * 6 + 3)
        segments++
      }
    }

    if (segments > 0) {
      lineGeometry.setDrawRange(0, segments * 2)
      lineGeometry.attributes.position.needsUpdate = true
      lineMaterial.color.set(color)
      lines.visible = true
    }
  }

  function flightSight (frame: HudFrame): void {
    lines.visible = false

    const pitch = pitchFrom(frame.hullQuaternion)
    const roll  = rollFrom(frame.hullQuaternion)
    const slip  = slipFrom(frame.hullQuaternion, frame.telemetry.velocity)
    const g     = frame.telemetry.gLoad

    // Quantised at what the ladder can show — half a degree of pitch is a
    // pixel — and repainted at the HUD's budget: it is an instrument, not a
    // mark that has to sit on something, so a frame's staleness is invisible.
    // It is drawn off-centre on its raster, to leave room for the horizon bar
    // to the right and the readout below, and the quad is shifted back by the
    // same amount so the ladder's centre is the boresight.
    const dx = -0.025
    const dy = -0.035
    paint(ladder, `${Math.round(pitch * 2)}|${Math.round(roll * 2)}|${Math.round(slip * 50)}|${Math.round(g * 10)}`, (panel, cx, cy, unit) => {
      const x = cx + unit * dx
      const y = cy + unit * dy
      drawPitchLadder(panel, {
        x,
        y,
        halfWidth:       unit * 0.24,
        halfHeight:      unit * 0.19,
        pitch,
        roll,
        pixelsPerDegree: unit * 0.0075,
        accent:          HUES.blue,
      })
      drawSlip(panel, x, y + unit * 0.215, unit, slip)
      overlayLabel(panel, `${Math.round(pitch)}° PITCH · ${Math.round(roll)}° BANK · ${g.toFixed(1)}G`, x, y + unit * 0.25, HUES.blue, unit)
    }, frame.elapsed, 1 / Math.max(10, Math.min(60, frame.drawHz)))
    // Canvas y runs down, the quad's up: the ladder sits at (dx, -dy) on the
    // quad, so the quad goes at (-dx, dy) to put it on the boresight.
    _point.set(-dx * unitWorld, dy * unitWorld, -SIGHT_DEPTH)
    show(ladder, _point)

    // Where the hull is actually going. On a craft with this much sideslip the
    // gap between the boresight and this marker IS the handling readout.
    _velocity.copy(frame.telemetry.velocity)
    if (_velocity.lengthSq() > 4) {
      _velocity.normalize().multiplyScalar(60)
        .add(frame.shipPosition)
      if (onRay(frame.camera, _velocity, _point)) {
        clampToFrame(_point, 0.05)
        paint(path, 'fpm', (panel, cx, cy, unit) => drawFlightPathMarker(panel, cx, cy, unit * 0.018, HUES.green))
        show(path, _point)
      }
    }
  }

  return {
    object,

    update (data, frame, aspect) {
      const camera = frame.camera
      // The rig has just moved the camera and nothing has refreshed its world
      // matrix yet — the renderer only does that when it draws. Projecting
      // against last frame's inverse is a frame of lag on every mark.
      camera.updateMatrixWorld()

      const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 60
      tanHalf   = Math.tan(THREE.MathUtils.degToRad(fov * 0.5))
      aspectNow = aspect
      // One `unit` is the frame's short edge, as it was on the overlay canvas.
      unitWorld = 2 * SIGHT_DEPTH * tanHalf * Math.min(1, aspect)

      object.position.copy(camera.position)
      object.quaternion.copy(camera.quaternion)

      for (const mark of marks)
        mark.mesh.visible = false

      if (data.mode === 'battle')
        gunSight(data.battle, frame)
      else
        flightSight(frame)

      object.updateMatrixWorld(true)
    },

    dispose () {
      for (const mark of marks) {
        mark.panel.dispose()
        mark.material.dispose()
      }
      quad.dispose()
      lineGeometry.dispose()
      lineMaterial.dispose()
      object.removeFromParent()
      object.clear()
    },
  }
}

/** The sideslip bar under the ladder. */
function drawSlip (panel: HudPanel, x: number, slipY: number, unit: number, slip: number): void {
  const { context } = panel
  context.save()
  context.strokeStyle = Math.abs(slip) > 0.35 ? THEME.red : HUES.blue
  context.globalAlpha = 0.7
  context.lineWidth   = 2

  const slipX         = x + slip * unit * 0.1
  context.strokeRect(slipX - unit * 0.014, slipY, unit * 0.028, unit * 0.012)
  context.globalAlpha = 0.3
  context.beginPath()
  context.moveTo(x - unit * 0.11, slipY + unit * 0.016)
  context.lineTo(x + unit * 0.11, slipY + unit * 0.016)
  context.stroke()
  context.restore()
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

/** A ring of dashes — spun by its quad while a lock is being acquired. */
function drawDashRing (overlay: HudPanel, x: number, y: number, radius: number, color: string): void {
  const { context } = overlay
  const dashCount   = 18
  const step        = TAU / dashCount
  const dashLength  = step * 0.5

  context.save()
  context.strokeStyle = color
  context.lineWidth   = 2.4
  context.globalAlpha = 0.85
  context.setLineDash([ radius * dashLength, radius * (step - dashLength) ])
  context.beginPath()
  context.arc(x, y, radius, 0, TAU)
  context.stroke()
  context.setLineDash([])
  context.restore()
}

/**
 * How much of the acquisition is actually done — the spin alone would never
 * say "how close".
 */
function drawAcquiringArc (
  overlay: HudPanel,
  x: number,
  y: number,
  radius: number,
  progress: number,
  color: string
): void {
  const { context } = overlay
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

export function drawKillFeed (
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
function overlayLabel (panel: HudPanel, value: string, x: number, y: number, color: string, unit: number): void {
  glowText(panel.context, `[ ${value} ]`, x, y, color, Math.max(10, unit * 0.021), 'center', 500, FONT)
}
