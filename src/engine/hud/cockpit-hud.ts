import * as THREE from 'three'
import { createArcGeometry, createArcTicks } from './arc'
import { createBar, createCanopyFrame } from './frame'
import type { HoloMesh, HoloPart } from './frame'
import { createHorizon } from './horizon'
import { createHoloMaterial, HOLO } from './materials'
import type { HoloMaterial } from './materials'
import { createReadout } from './text'
import type { Readout } from './text'
import { SPEED_SCALE } from './types'
import type { HudFrame } from './types'
import { formatTime } from '@/hooks/use-race-store'

/** Distance from the eye to the projection plane, in ship-local units. */
const PANEL_DISTANCE = 1.2

/** Eye position in the ship's local space — must match `COCKPIT.offset` in the camera rig. */
const EYE = new THREE.Vector3(0, 0.78, 0.55)

/** How far a bearing has to swing to run the compass marker to the edge. */
const BEARING_RANGE = Math.PI / 2

// --- parallax + DOF tuning ------------------------------------------------
// The entire HUD group shifts opposite to the pointer, simulating the eye
// refocusing through a fixed glass canopy. The magnitude is small — too much
// and the elements swim. Speed compounds the effect: at high velocity the
// peripheral elements dim further, pulling focus to the crosshair.

/** Max metres the HUD shifts opposite to the pointer, per axis. */
const PARALLAX_STRENGTH_X = 0.025
const PARALLAX_STRENGTH_Y = 0.015

/**
 * DOF blend: elements far from the pointer focus dim more. This is the max
 * additional opacity reduction at the edges (on top of the speed factor).
 */
const DOF_POINTER_MAX = 0.35
const DOF_SPEED_MAX   = 0.40

/** Easing factor for the smooth parallax follow — lower is lazier. */
const PARALLAX_EASE = 6

const _toGate = new THREE.Vector3()
const _fwd    = new THREE.Vector3()
const _right  = new THREE.Vector3()

export type CockpitHud = {
  object: THREE.Object3D;
  update(frame: HudFrame): void;
  dispose(): void;
}

// --- side panel zone enum --------------------------------------------------
// Left panel = navigation/race data (amber). Right panel = systems (cyan).
// Each is rotated inward around the Y axis so it reads like an angled console.

const SIDE_PANEL_ANGLE = Math.PI / 5.5     // ~33 degrees inward
const SIDE_PANEL_X     = 0.72              // horizontal offset from centre
const SIDE_PANEL_Z     = PANEL_DISTANCE - 0.08 // slightly closer than the main panel

/**
 * The seated HUD — rewritten with tilted side panels, a centre crosshair,
 * flight-dynamics readout bars, pointer-relative parallax shift, and a dual
 * DOF effect (pointer focus + speed).
 *
 * Parented to `shipRoot`, which means it inherits the interpolated pose for
 * free and — more importantly — banks with the hull, so it reads as glass
 * bolted into the cockpit rather than as a screen overlay. The one element that
 * must NOT bank is the horizon, which counter-rotates itself.
 */
export function createCockpitHud (): CockpitHud {
  const group = new THREE.Group()
  group.position.copy(EYE)
  // Render after the world so additive HUD fragments land on top of it.
  group.renderOrder = 10

  const materials: HoloMaterial[] = []
  const disposers: (() => void)[] = []
  const readouts: Readout[]       = []

  // Smoothed parallax target — lerped toward the pointer each frame so the
  // HUD slides rather than snapping.
  let smoothPanX    = 0
  let smoothPanY    = 0
  let prevElapsed   = 0

  // ---- main centre panel --------------------------------------------------
  const panel      = new THREE.Group()
  panel.position.z = PANEL_DISTANCE

  // Authored in SCREEN axes — x right, y up, facing the viewer — then turned to
  // face back down the nose. Both halves of that matter: the camera looks along
  // the ship's +Z, so its right axis is the ship's -X, and without this the
  // whole panel is mirrored. The planes would also be presenting their back
  // faces, which silently culls every text readout, since `MeshBasicMaterial`
  // is FrontSide by default.
  panel.rotation.y = Math.PI

  group.add(panel)

  // ---- tilted side panels -------------------------------------------------
  // Left panel: navigation & race data, amber tint.
  // Right panel: systems & shields, cyan tint.
  const sideLeft  = new THREE.Group()
  sideLeft.position.set(-SIDE_PANEL_X, -0.08, SIDE_PANEL_Z)
  sideLeft.rotation.y = Math.PI + SIDE_PANEL_ANGLE // face back + rotate inward

  const sideRight = new THREE.Group()
  sideRight.position.set(SIDE_PANEL_X, -0.08, SIDE_PANEL_Z)
  sideRight.rotation.y = Math.PI - SIDE_PANEL_ANGLE

  group.add(sideLeft)
  group.add(sideRight)

  // Per-zone material + readout trackers so the DOF pass can weight them by
  // their horizontal position.
  type ZonePart = { material: HoloMaterial; zoneX: number }
  const zoneParts: ZonePart[] = []

  const sideReadouts: { readout: Readout; zoneX: number }[] = []

  // ---- helpers ------------------------------------------------------------
  const addPart = <T extends HoloPart>(part: T) => {
    materials.push(...part.materials)
    disposers.push(part.dispose)
    panel.add(part.object)
    // Centre zone
    for (const m of part.materials)
      zoneParts.push({ material: m, zoneX: 0 })
    return part
  }

  const addBar = (part: HoloMesh, parent: THREE.Object3D = panel, zoneX = 0) => {
    materials.push(part.material)
    disposers.push(part.dispose)
    parent.add(part.mesh)
    zoneParts.push({ material: part.material, zoneX })
    return part.mesh
  }

  const addReadout = (readout: Readout, x: number, y: number, parent: THREE.Object3D = panel, zoneX = 0) => {
    readout.mesh.position.set(x, y, 0.001)
    readouts.push(readout)
    disposers.push(readout.dispose)
    parent.add(readout.mesh)
    sideReadouts.push({ readout, zoneX })
    return readout
  }

  // ---- helpers: side panel geometry ---------------------------------------
  function buildSidePanelBacking (parent: THREE.Group, color: string, zoneX: number) {
    // A subtle translucent backing plane — sells the "angled glass console" look.
    const geo = new THREE.PlaneGeometry(0.38, 0.72)
    const mat = createHoloMaterial({ color, opacity: 0.12, gain: 0.5, scan: 6 })
    const mesh = new THREE.Mesh(geo, mat)
    parent.add(mesh)
    materials.push(mat)
    zoneParts.push({ material: mat, zoneX })
    disposers.push(() => { geo.dispose(); mat.dispose() })
  }

  function buildSidePanelBorder (parent: THREE.Group, color: string, zoneX: number) {
    // Thin edge lines around the panel.
    const w = 0.38
    const h = 0.72
    const t = 0.006
    const edges: [number, number, number, number, number][] = [
      [0, h / 2, w, t, 0],       // top
      [0, -h / 2, w, t, 0],      // bottom
      [-w / 2, 0, t, h, Math.PI / 2], // left
      [w / 2, 0, t, h, Math.PI / 2],  // right
    ]
    for (const [x, y, len, thick, rot] of edges) {
      const bar = createBar(len, thick, { color, opacity: 0.55, gain: 0.9 })
      bar.mesh.position.set(x, y, 0.001)
      bar.mesh.rotation.z = rot
      parent.add(bar.mesh)
      materials.push(bar.material)
      zoneParts.push({ material: bar.material, zoneX })
      disposers.push(bar.dispose)
    }
  }

  // ---- structure: canopy frame + horizon ----------------------------------
  addPart(createCanopyFrame())

  const horizon = createHorizon()
  addPart(horizon)

  // ---- centre crosshair reticle -------------------------------------------
  // A ring + cross, like the reference image. Built from a torus ring and two
  // perpendicular thin bars so it reads at any angle.
  {
    const ringGeo = new THREE.RingGeometry(0.055, 0.065, 32)
    const ringMat = createHoloMaterial({ color: HOLO.cyan, opacity: 0.95, gain: 1.4 })
    const ring    = new THREE.Mesh(ringGeo, ringMat)
    ring.position.set(0, 0.08, 0)
    panel.add(ring)
    materials.push(ringMat)
    zoneParts.push({ material: ringMat, zoneX: 0 })
    disposers.push(() => { ringGeo.dispose(); ringMat.dispose() })

    // Crosshair lines
    const crossLen = 0.12
    const crossT   = 0.004
    for (const rot of [0, Math.PI / 2]) {
      const cBar = createBar(crossLen, crossT, { color: HOLO.cyan, opacity: 0.7, gain: 1.2 })
      cBar.mesh.position.set(0, 0.08, 0.001)
      cBar.mesh.rotation.z = rot
      panel.add(cBar.mesh)
      materials.push(cBar.material)
      zoneParts.push({ material: cBar.material, zoneX: 0 })
      disposers.push(cBar.dispose)
    }
  }

  // ---- gauges: speed (left arc) + boost (right arc) -----------------------
  const speedArc = buildArc(-0.72, 240 * THREE.MathUtils.DEG2RAD, -120 * THREE.MathUtils.DEG2RAD, HOLO.cyan, -0.5)
  const boostArc = buildArc(0.72, -60 * THREE.MathUtils.DEG2RAD, 120 * THREE.MathUtils.DEG2RAD, HOLO.magenta, 0.5)

  function buildArc (x: number, start: number, sweep: number, color: string, zoneX: number) {
    const holder = new THREE.Group()
    holder.position.set(x, 0, 0)
    panel.add(holder)

    const bandGeometry = createArcGeometry(0.30, 0.345, start, sweep, 72)
    const bandMaterial = createHoloMaterial({ color, opacity: 0.95, gain: 1.25, scan: 4 })
    holder.add(new THREE.Mesh(bandGeometry, bandMaterial))

    const tickGeometry = createArcTicks(0.355, 0.035, start, sweep, 13, 0.004)
    const tickMaterial = createHoloMaterial({ color, opacity: 0.7, gain: 0.9 })
    holder.add(new THREE.Mesh(tickGeometry, tickMaterial))

    materials.push(bandMaterial, tickMaterial)
    zoneParts.push({ material: bandMaterial, zoneX }, { material: tickMaterial, zoneX })
    disposers.push(() => {
      bandGeometry.dispose()
      bandMaterial.dispose()
      tickGeometry.dispose()
      tickMaterial.dispose()
    })

    return { band: bandMaterial, ticks: tickMaterial }
  }

  const speedText = addReadout(createReadout({
    width: 0.44, height: 0.18, color: HOLO.white, label: 'KM/H',
  }), -0.72, 0, panel, -0.5)

  const boostText = addReadout(createReadout({
    width: 0.44, height: 0.18, color: HOLO.magenta, label: 'BOOST',
  }), 0.72, 0, panel, 0.5)

  // ---- thrust bar ---------------------------------------------------------
  const thrustTrack = addBar(createBar(0.90, 0.018, {
    color: HOLO.cyan, opacity: 0.22, gain: 0.7,
  }))
  thrustTrack.position.set(0, -0.56, 0)

  const thrust = addBar(createBar(0.90, 0.018, {
    color: HOLO.amber, opacity: 1, gain: 1.4, fill: 0,
  }))
  thrust.position.set(0, -0.56, 0.001)

  // ---- compass marker -----------------------------------------------------
  const bearing = addBar(createBar(0.05, 0.014, {
    color: HOLO.magenta, opacity: 1, gain: 1.6,
  }))
  bearing.position.set(0, 0.56, 0.001)

  // ---- race readouts (top) ------------------------------------------------
  const lapText  = addReadout(createReadout({
    width: 0.34, height: 0.13, color: HOLO.cyan, label: 'LAP',
  }), -0.48, 0.36)

  const timeText = addReadout(createReadout({
    width: 0.42, height: 0.13, color: HOLO.white, label: 'TIME',
  }), 0, 0.36)

  const bestText = addReadout(createReadout({
    width: 0.38, height: 0.13, color: HOLO.cyan, label: 'BEST',
  }), 0.48, 0.36)

  // ---- flight dynamics readouts (centre-bottom panel) ---------------------
  // PITCH, YAW, ROLL bars — the reference image shows labelled gauge bars.
  const pitchLabel = addReadout(createReadout({
    width: 0.30, height: 0.10, color: HOLO.cyan, label: 'PITCH',
  }), -0.14, -0.30, panel, 0)

  const pitchTrack = addBar(createBar(0.50, 0.016, {
    color: HOLO.cyan, opacity: 0.20, gain: 0.6,
  }))
  pitchTrack.position.set(0.18, -0.30, 0)

  const pitchFill = addBar(createBar(0.50, 0.016, {
    color: HOLO.cyan, opacity: 0.85, gain: 1.2, fill: 0.5,
  }))
  pitchFill.position.set(0.18, -0.30, 0.001)

  const yawLabel = addReadout(createReadout({
    width: 0.30, height: 0.10, color: HOLO.cyan, label: 'YAW',
  }), -0.14, -0.40, panel, 0)

  const yawTrack = addBar(createBar(0.50, 0.016, {
    color: HOLO.cyan, opacity: 0.20, gain: 0.6,
  }))
  yawTrack.position.set(0.18, -0.40, 0)

  const yawFill = addBar(createBar(0.50, 0.016, {
    color: HOLO.cyan, opacity: 0.85, gain: 1.2, fill: 0.5,
  }))
  yawFill.position.set(0.18, -0.40, 0.001)

  const rollLabel = addReadout(createReadout({
    width: 0.30, height: 0.10, color: HOLO.cyan, label: 'ROLL',
  }), -0.14, -0.50, panel, 0)

  const rollTrack = addBar(createBar(0.50, 0.016, {
    color: HOLO.cyan, opacity: 0.20, gain: 0.6,
  }))
  rollTrack.position.set(0.18, -0.50, 0)

  const rollFill = addBar(createBar(0.50, 0.016, {
    color: HOLO.cyan, opacity: 0.85, gain: 1.2, fill: 0.5,
  }))
  rollFill.position.set(0.18, -0.50, 0.001)

  // ---- left side panel: NAV + race data (amber) ---------------------------
  buildSidePanelBacking(sideLeft, HOLO.amber, -1)
  buildSidePanelBorder(sideLeft, HOLO.amber, -1)

  const sideNavTitle = addReadout(createReadout({
    width: 0.34, height: 0.10, color: HOLO.amber, label: 'NAV',
  }), 0, 0.26, sideLeft, -1)

  const sideSpeedReadout = addReadout(createReadout({
    width: 0.34, height: 0.10, color: HOLO.amber, label: 'SPEED',
  }), 0, 0.12, sideLeft, -1)

  const sideDistReadout = addReadout(createReadout({
    width: 0.34, height: 0.10, color: HOLO.amber, label: 'DIST',
  }), 0, -0.02, sideLeft, -1)

  const sideLapReadout = addReadout(createReadout({
    width: 0.34, height: 0.10, color: HOLO.amber, label: 'LAP',
  }), 0, -0.16, sideLeft, -1)

  // ---- right side panel: SYS & shields (cyan) -----------------------------
  buildSidePanelBacking(sideRight, HOLO.cyan, 1)
  buildSidePanelBorder(sideRight, HOLO.cyan, 1)

  const sideSysTitle = addReadout(createReadout({
    width: 0.34, height: 0.10, color: HOLO.cyan, label: 'SYS',
  }), 0, 0.26, sideRight, 1)

  const sideShieldReadout = addReadout(createReadout({
    width: 0.34, height: 0.10, color: HOLO.cyan, label: 'SHIELDS',
  }), 0, 0.12, sideRight, 1)

  const sideThrusterReadout = addReadout(createReadout({
    width: 0.34, height: 0.10, color: HOLO.cyan, label: 'THRUSTERS',
  }), 0, -0.02, sideRight, 1)

  const sideBoostReadout = addReadout(createReadout({
    width: 0.34, height: 0.10, color: HOLO.cyan, label: 'BOOST',
  }), 0, -0.16, sideRight, 1)

  // Side panel thruster bars
  const thrBarTrack = addBar(createBar(0.32, 0.014, {
    color: HOLO.cyan, opacity: 0.18, gain: 0.5,
  }), sideRight, 1)
  thrBarTrack.position.set(0, -0.25, 0)

  const thrBarFill = addBar(createBar(0.32, 0.014, {
    color: HOLO.cyan, opacity: 0.80, gain: 1.1, fill: 0,
  }), sideRight, 1)
  thrBarFill.position.set(0, -0.25, 0.001)

  // ---- Euler scratch object for flight dynamics ---------------------------
  const _euler = new THREE.Euler()

  return {
    object: group,

    update (frame) {
      const { telemetry, race, blend } = frame

      // Below the fade floor there is nothing to see, so skip the whole update
      // rather than paying for readout draws no one will look at.
      const visible = blend > 0.02
      group.visible = visible
      if (!visible)
        return

      // ---- parallax shift -------------------------------------------------
      // Smooth-follow the pointer so the HUD drifts opposite to where the
      // pilot looks, like a projection on a fixed canopy.
      const dt    = Math.min(frame.elapsed - prevElapsed || 1 / 60, 0.1)
      const ease  = 1 - Math.exp(-PARALLAX_EASE * dt)
      smoothPanX += (frame.panX - smoothPanX) * ease
      smoothPanY += (frame.panY - smoothPanY) * ease
      prevElapsed = frame.elapsed

      // Shift the whole group in the opposite direction of the pointer.
      group.position.x = EYE.x - smoothPanX * PARALLAX_STRENGTH_X
      group.position.y = EYE.y - smoothPanY * PARALLAX_STRENGTH_Y

      // ---- DOF blend ------------------------------------------------------
      // Two components:
      // 1) Speed DOF: faster = dimmer periphery.
      // 2) Pointer DOF: elements further from the pointer focus dim more.
      const speedFactor    = THREE.MathUtils.clamp(telemetry.speed / SPEED_SCALE, 0, 1)
      const speedDof       = 1 - DOF_SPEED_MAX * speedFactor

      for (const { material, zoneX } of zoneParts) {
        material.uniforms.uTime.value = frame.elapsed
        if (material.userData.baseOpacity === undefined)
          material.userData.baseOpacity = material.uniforms.uOpacity.value

        // Pointer DOF: distance in normalised HUD space from the zone's
        // centre to the pointer. Zones are at zoneX = -1 (left), 0 (centre),
        // +1 (right). The pointer is panX in -1..1.
        const pointerDist = Math.abs(zoneX - frame.panX)
        const pointerDof  = 1 - DOF_POINTER_MAX * THREE.MathUtils.clamp(pointerDist, 0, 1)

        material.uniforms.uOpacity.value =
          material.userData.baseOpacity * blend * speedDof * pointerDof
      }

      for (const { readout, zoneX } of sideReadouts) {
        const pointerDist = Math.abs(zoneX - frame.panX)
        const pointerDof  = 1 - DOF_POINTER_MAX * THREE.MathUtils.clamp(pointerDist, 0, 1)
        readout.setOpacity(blend * speedDof * pointerDof)
      }

      // ---- speed + boost gauges -------------------------------------------
      const speed                         = telemetry.speed
      speedArc.band.uniforms.uFill.value  = THREE.MathUtils.clamp(speed / SPEED_SCALE, 0, 1)
      speedArc.ticks.uniforms.uFill.value = speedArc.band.uniforms.uFill.value
      speedText.set((speed * 3.6).toFixed(0))

      boostArc.band.uniforms.uFill.value  = THREE.MathUtils.clamp(telemetry.boostMeter, 0, 1)
      boostArc.ticks.uniforms.uFill.value = boostArc.band.uniforms.uFill.value
      boostText.set(`${Math.round(telemetry.boostMeter * 100)}`)

      const thrustMaterial                = thrust.material as HoloMaterial
      thrustMaterial.uniforms.uFill.value = THREE.MathUtils.clamp(frame.throttle, 0, 1)

      horizon.update(frame.hullQuaternion)

      // ---- race readouts --------------------------------------------------
      lapText.set(race.loop ? `${Math.min(race.currentLap, race.laps)}/${race.laps}` : 'SPRINT')
      timeText.set(formatTime(race.elapsed))
      bestText.set(race.bestLap === null ? '--:--' : formatTime(race.bestLap))

      // ---- flight dynamics bars -------------------------------------------
      // Extract pitch / yaw / roll from hull quaternion.
      _euler.setFromQuaternion(frame.hullQuaternion, 'YXZ')

      // Normalise to 0..1 range — pitch ±90°, yaw ±180°, roll ±180°.
      const pitchNorm = THREE.MathUtils.clamp((_euler.x / (Math.PI / 2)) * 0.5 + 0.5, 0, 1)
      const yawNorm   = THREE.MathUtils.clamp((_euler.y / Math.PI) * 0.5 + 0.5, 0, 1)
      const rollNorm  = THREE.MathUtils.clamp((_euler.z / Math.PI) * 0.5 + 0.5, 0, 1)

      ;(pitchFill.material as HoloMaterial).uniforms.uFill.value = pitchNorm
      ;(yawFill.material as HoloMaterial).uniforms.uFill.value   = yawNorm
      ;(rollFill.material as HoloMaterial).uniforms.uFill.value  = rollNorm

      pitchLabel.set((_euler.x * THREE.MathUtils.RAD2DEG).toFixed(0) + '°')
      yawLabel.set((_euler.y * THREE.MathUtils.RAD2DEG).toFixed(0) + '°')
      rollLabel.set((_euler.z * THREE.MathUtils.RAD2DEG).toFixed(0) + '°')

      // ---- side panel data ------------------------------------------------
      sideNavTitle.set('NAV')
      sideSpeedReadout.set((speed * 3.6).toFixed(0))
      sideDistReadout.set(
        frame.gate
          ? _toGate.copy(frame.gate).sub(frame.shipPosition).length().toFixed(0) + 'm'
          : '---'
      )
      sideLapReadout.set(
        race.loop
          ? `${Math.min(race.currentLap, race.laps)}/${race.laps}`
          : '---'
      )

      sideSysTitle.set('SYS & SHIELDS')
      sideShieldReadout.set('100%')
      sideThrusterReadout.set('NOMINAL')
      sideBoostReadout.set(`${Math.round(telemetry.boostMeter * 100)}%`)

      // Thruster bar on the right panel tracks throttle.
      ;(thrBarFill.material as HoloMaterial).uniforms.uFill.value =
        THREE.MathUtils.clamp(frame.throttle, 0, 1)

      // ---- compass marker -------------------------------------------------
      if (frame.gate) {
        _toGate.copy(frame.gate).sub(frame.shipPosition)
        _fwd.set(0, 0, 1).applyQuaternion(frame.hullQuaternion)
        // Screen right = ship -X, same as the horizon. With +X the marker swings
        // away from the gate instead of toward it.
        _right.set(-1, 0, 0).applyQuaternion(frame.hullQuaternion)
        _toGate.y          = 0

        const angle        = Math.atan2(_toGate.dot(_right), _toGate.dot(_fwd))
        bearing.visible    = true
        bearing.position.x = THREE.MathUtils.clamp(angle / BEARING_RANGE, -1, 1) * 0.5
      }
      else
        bearing.visible = false
    },

    dispose () {
      for (const dispose of disposers)
        dispose()
      group.clear()
    },
  }
}
