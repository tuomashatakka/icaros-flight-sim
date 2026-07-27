import * as THREE from 'three'
import { createArcGeometry } from './arc'
import { createBar } from './frame'
import type { HoloMesh } from './frame'
import { createHoloMaterial, HOLO } from './materials'
import type { HoloMaterial } from './materials'
import { createReadout } from './text'
import type { Readout } from './text'
import { SPEED_SCALE } from './types'
import type { HudFrame } from './types'
import { formatTime } from '@/hooks/use-race-store'

/** Distance in front of the camera. Chase FOV is 40, so this frames at ~0.44 half-height. */
const PANEL_DISTANCE = 1.2

export type ChaseHud = {
  object: THREE.Object3D;
  update(frame: HudFrame): void;
  dispose(): void;
}

/**
 * The chase-view strip.
 *
 * Same visual language as the cockpit so the two read as one system, but pared
 * back — from outside the ship the HUD is an overlay, not a canopy, and a full
 * bezel out here just fights the view.
 *
 * Camera-locked by copying the camera's transform each frame rather than by
 * parenting to it. A camera is not part of the scene graph, so its children are
 * never traversed by the renderer unless it is explicitly added to the scene —
 * copying the transform sidesteps that entirely.
 */
export function createChaseHud (): ChaseHud {
  const group       = new THREE.Group()
  group.renderOrder = 10

  const materials: HoloMaterial[] = []
  const disposers: (() => void)[] = []
  const readouts: Readout[]       = []

  const addBar = (part: HoloMesh) => {
    materials.push(part.material)
    disposers.push(part.dispose)
    group.add(part.mesh)
    return part.mesh
  }

  const addReadout = (readout: Readout, x: number, y: number) => {
    readout.mesh.position.set(x, y, 0.001)
    readouts.push(readout)
    disposers.push(readout.dispose)
    group.add(readout.mesh)
    return readout
  }

  // Speed arc, bottom left, sweeping upward.
  const arcGeometry = createArcGeometry(
    0.13,
    0.155,
    240 * THREE.MathUtils.DEG2RAD,
    -120 * THREE.MathUtils.DEG2RAD,
    64
  )
  const arcMaterial = createHoloMaterial({ color: HOLO.cyan, opacity: 0.95, gain: 1.25, scan: 4 })
  const arc         = new THREE.Mesh(arcGeometry, arcMaterial)
  arc.position.set(-0.52, -0.16, 0)
  materials.push(arcMaterial)
  disposers.push(() => {
    arcGeometry.dispose()
    arcMaterial.dispose()
  })
  group.add(arc)

  const speedText = addReadout(createReadout({
    width: 0.24, height: 0.10, color: HOLO.white, label: 'KM/H',
  }), -0.52, -0.16)

  // Boost reserve, bottom centre.
  const boostTrack = addBar(createBar(0.56, 0.014, { color: HOLO.magenta, opacity: 0.2, gain: 0.7 }))
  boostTrack.position.set(0, -0.33, 0)

  const boost = addBar(createBar(0.56, 0.014, { color: HOLO.magenta, opacity: 1, gain: 1.4, fill: 0 }))
  boost.position.set(0, -0.33, 0.001)

  const lapText  = addReadout(createReadout({
    width: 0.26, height: 0.10, color: HOLO.cyan, label: 'LAP',
  }), -0.36, 0.30)

  const timeText = addReadout(createReadout({
    width: 0.32, height: 0.10, color: HOLO.white, label: 'TIME',
  }), 0, 0.30)

  const bestText = addReadout(createReadout({
    width: 0.28, height: 0.10, color: HOLO.cyan, label: 'BEST',
  }), 0.36, 0.30)

  return {
    object: group,

    update (frame) {
      const { telemetry, race } = frame
      const opacity             = 1 - frame.blend

      const visible = opacity > 0.02
      group.visible = visible
      if (!visible)
        return

      group.position.copy(frame.camera.position)
      group.quaternion.copy(frame.camera.quaternion)
      group.translateZ(-PANEL_DISTANCE)

      for (const material of materials) {
        material.uniforms.uTime.value = frame.elapsed
        if (material.userData.baseOpacity === undefined)
          material.userData.baseOpacity = material.uniforms.uOpacity.value
        material.uniforms.uOpacity.value = material.userData.baseOpacity * opacity
      }

      for (const readout of readouts)
        readout.setOpacity(opacity)

      arcMaterial.uniforms.uFill.value = THREE.MathUtils.clamp(telemetry.speed / SPEED_SCALE, 0, 1)
      speedText.set((telemetry.speed * 3.6).toFixed(0));

      (boost.material as HoloMaterial).uniforms.uFill.value =
        THREE.MathUtils.clamp(telemetry.boostMeter, 0, 1)

      lapText.set(race.loop ? `${Math.min(race.currentLap, race.laps)}/${race.laps}` : 'SPRINT')
      timeText.set(formatTime(race.elapsed))
      bestText.set(race.bestLap === null ? '--:--' : formatTime(race.bestLap))
    },

    dispose () {
      for (const dispose of disposers)
        dispose()
      group.clear()
    },
  }
}
