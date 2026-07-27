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

const _toGate = new THREE.Vector3()
const _fwd    = new THREE.Vector3()
const _right  = new THREE.Vector3()

export type CockpitHud = {
  object: THREE.Object3D;
  update(frame: HudFrame): void;
  dispose(): void;
}

/**
 * The seated HUD.
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

  const addPart = <T extends HoloPart>(part: T) => {
    materials.push(...part.materials)
    disposers.push(part.dispose)
    panel.add(part.object)
    return part
  }

  const addBar = (part: HoloMesh) => {
    materials.push(part.material)
    disposers.push(part.dispose)
    panel.add(part.mesh)
    return part.mesh
  }

  const addReadout = (readout: Readout, x: number, y: number) => {
    readout.mesh.position.set(x, y, 0.001)
    readouts.push(readout)
    disposers.push(readout.dispose)
    panel.add(readout.mesh)
    return readout
  }

  // --- structure ----------------------------------------------------------
  addPart(createCanopyFrame())

  const horizon = createHorizon()
  addPart(horizon)

  // --- gauges -------------------------------------------------------------
  // Both arcs sweep from bottom to top so they fill upward. The left one bulges
  // left and the right one right, away from the centre of vision.
  const speedArc = buildArc(-0.72, 240 * THREE.MathUtils.DEG2RAD, -120 * THREE.MathUtils.DEG2RAD, HOLO.cyan)
  const boostArc = buildArc(0.72, -60 * THREE.MathUtils.DEG2RAD, 120 * THREE.MathUtils.DEG2RAD, HOLO.magenta)

  function buildArc (x: number, start: number, sweep: number, color: string) {
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
  }), -0.72, 0)

  const boostText = addReadout(createReadout({
    width: 0.44, height: 0.18, color: HOLO.magenta, label: 'BOOST',
  }), 0.72, 0)

  // --- thrust bar ---------------------------------------------------------
  const thrustTrack = addBar(createBar(0.90, 0.018, {
    color: HOLO.cyan, opacity: 0.22, gain: 0.7,
  }))
  thrustTrack.position.set(0, -0.56, 0)

  const thrust = addBar(createBar(0.90, 0.018, {
    color: HOLO.amber, opacity: 1, gain: 1.4, fill: 0,
  }))
  thrust.position.set(0, -0.56, 0.001)

  // --- compass marker -----------------------------------------------------
  const bearing = addBar(createBar(0.05, 0.014, {
    color: HOLO.magenta, opacity: 1, gain: 1.6,
  }))
  bearing.position.set(0, 0.56, 0.001)

  // --- race readouts ------------------------------------------------------
  const lapText  = addReadout(createReadout({
    width: 0.34, height: 0.13, color: HOLO.cyan, label: 'LAP',
  }), -0.48, 0.36)

  const timeText = addReadout(createReadout({
    width: 0.42, height: 0.13, color: HOLO.white, label: 'TIME',
  }), 0, 0.36)

  const bestText = addReadout(createReadout({
    width: 0.38, height: 0.13, color: HOLO.cyan, label: 'BEST',
  }), 0.48, 0.36)

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

      // Cross-fade by scaling each element's AUTHORED opacity. That value has to
      // be cached on first use — reading it back from the uniform would read the
      // faded value we wrote last frame and ratchet the HUD to nothing.
      for (const material of materials) {
        material.uniforms.uTime.value = frame.elapsed
        if (material.userData.baseOpacity === undefined)
          material.userData.baseOpacity = material.uniforms.uOpacity.value
        material.uniforms.uOpacity.value = material.userData.baseOpacity * blend
      }

      for (const readout of readouts)
        readout.setOpacity(blend)

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

      lapText.set(race.loop ? `${Math.min(race.currentLap, race.laps)}/${race.laps}` : 'SPRINT')
      timeText.set(formatTime(race.elapsed))
      bestText.set(race.bestLap === null ? '--:--' : formatTime(race.bestLap))

      // Compass marker: signed bearing to the gate, in the hull's own frame.
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
