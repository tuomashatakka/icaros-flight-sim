import * as THREE from 'three'
import { createBar } from './frame'
import type { HoloMesh, HoloPart } from './frame'
import { HOLO } from './materials'
import type { HoloMaterial } from './materials'


const _toCamera = new THREE.Vector3()

export type NavMarker = HoloPart & {

  /**
   * Aim the bracket at the next gate.
   *
   * @param gate - World position of the gate, or null when there isn't one.
   * @param camera - Billboarded toward this, and used to scale with distance.
   */
  update(gate: THREE.Vector3 | null, camera: THREE.Camera): void;
}

/** Apparent size is held roughly constant, so the bracket does not shrink to nothing down a long straight. */
const APPARENT_SIZE = 0.055
const MIN_SCALE     = 1
const MAX_SCALE     = 26

/**
 * A bracket floating over the next checkpoint.
 *
 * Lives in WORLD space rather than in the cockpit group: it marks a place on
 * the track, so it has to stay there while the ship rolls past it. Billboarded,
 * because a flat bracket seen edge-on is invisible exactly when you need it.
 */
export function createNavMarker (): NavMarker {
  const group                     = new THREE.Group()
  const materials: HoloMaterial[] = []
  const disposers: (() => void)[] = []

  const add = (part: HoloMesh) => {
    materials.push(part.material)
    disposers.push(part.dispose)
    group.add(part.mesh)
    return part.mesh
  }

  // Four corner brackets around an empty centre — the gate itself is the thing
  // you need to see, so the marker deliberately does not fill it.
  const corners: [number, number, number, number][] = [
    [ -1, 1, 1, -1 ],
    [ 1, 1, -1, -1 ],
    [ -1, -1, 1, 1 ],
    [ 1, -1, -1, 1 ],
  ]

  for (const [ sx, sy, dx, dy ] of corners) {
    const horizontal = add(createBar(0.34, 0.03, { color: HOLO.magenta, opacity: 1, gain: 1.5 }))
    horizontal.position.set(sx * 0.5 + dx * 0.17, sy * 0.5, 0)

    const vertical = add(createBar(0.34, 0.03, { color: HOLO.magenta, opacity: 1, gain: 1.5 }))
    vertical.position.set(sx * 0.5, sy * 0.5 + dy * 0.17, 0)
    vertical.rotation.z = Math.PI / 2
  }

  group.visible = false

  return {
    object: group,
    materials,

    update (gate, camera) {
      if (!gate) {
        group.visible = false
        return
      }

      group.position.copy(gate)
      _toCamera.copy(camera.position).sub(gate)

      const distance = _toCamera.length()
      if (distance < 1e-3) {
        group.visible = false
        return
      }

      group.visible = true
      group.quaternion.copy(camera.quaternion)

      const scale = THREE.MathUtils.clamp(distance * APPARENT_SIZE, MIN_SCALE, MAX_SCALE)
      group.scale.setScalar(scale)
    },

    dispose () {
      for (const dispose of disposers)
        dispose()
    },
  }
}
