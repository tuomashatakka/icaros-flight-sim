import type * as THREE from 'three'
import { defineModule } from 'threejs-scene'
import type { AppModule } from 'threejs-scene'
import { createAirbrakes } from '../fx/airbrakes'
import type { Airbrakes } from '../fx/airbrakes'
import { loadShip } from '../assets/ship-loader'
import type { ShipInstance } from '../assets/ship-loader'
import type { RaceState } from '../state'
import type { Telemetry } from '../telemetry'
import type { ShipConfig } from '@/lib/ship/registry'
import { changedBeyond } from '../render/invalidation'

/** Roughly the chassis length, so the hull matches its collider. */
const SHIP_TARGET_SIZE = 2.8

/** Lifts the model off the collider centre, as the R3F build's wrapper group did. */
const VISUAL_LIFT     = 0.5
const CONTROL_EPSILON = 0.001
const AIM_EPSILON     = 0.0001

export type ShipVisualHandle = {

  /**
   * Tip the hull's nose, radians, positive = up.
   *
   * Applied to the loaded model, NOT to `shipRoot`: the render phase writes the
   * root's pose straight from the interpolator and the HUD and camera anchor off
   * it, so pitching the root would drag the whole cockpit with it. This is a
   * pointing gesture, not a physical attitude — the upright control in
   * `vehicle.ts` never sees it.
   */
  setAimPitch(radians: number): void;

  /** Advance display-rate plume easing with the scene's capped visual delta. */
  updateVisual(delta: number, elapsed: number): void;

  /**
   * Show or hide the exterior hull. Called from the render phase as the camera
   * seats itself — at full cockpit the hull encloses the camera, so what you
   * would otherwise see is the inside of its back faces.
   */
  setHullVisible(visible: boolean): void;

  /**
   * Muzzle tips of the DRAWN guns, world space, appended into `out`.
   *
   * Empty until a hull has loaded. The battle sight uses these for its
   * convergence lines — see `Cannons.muzzleWorld`.
   */
  muzzleWorld(out: THREE.Vector3[]): THREE.Vector3[];
}

type HandleType = { current: ShipVisualHandle | null }

/**
 * The visible hull.
 *
 * Loading is async but `build` is not: the ship root is added to the scene
 * immediately and the model is attached when it resolves, so the frame loop
 * never waits on an asset.
 */
export function shipVisualModule (
  shipRoot: THREE.Group,
  telemetry: Telemetry,
  handle?: HandleType
): AppModule<RaceState> {
  let instance: ShipInstance | null               = null
  let lastConfig: ShipConfig | null               = null
  let glowMaterials: THREE.MeshStandardMaterial[] = []
  let airbrakes: Airbrakes | null                 = null

  /** Guards against a slow load for ship A landing after the user picked B. */
  let generation = 0

  // Kept out of the instance so a hull swap while seated does not pop the new
  // model into view for a frame.
  let hullVisible = true

  // Survives a hull swap: reapplied in `swapTo` so changing ship mid-hold does
  // not silently snap the nose back to level.
  let aimPitch                     = 0
  let lastRenderedAim              = Number.NaN
  let lastAirbrake                 = Number.NaN
  let lastBoosting: boolean | null = null
  let lastThrottle                 = Number.NaN

  async function swapTo (config: ShipConfig) {
    const mine = ++generation
    const next = await loadShip(config.shipId, SHIP_TARGET_SIZE)
    if (mine !== generation) {
      next.dispose()
      return
    }

    airbrakes?.dispose()
    instance?.dispose()
    instance = next
    next.applyConfig(config)
    next.root.position.y = VISUAL_LIFT
    next.root.visible    = hullVisible
    // Negative: a +X rotation swings +Z (forward) toward -Y, i.e. nose DOWN.
    next.root.rotation.x = -aimPitch
    lastRenderedAim      = aimPitch
    shipRoot.add(next.root)

    // Built AFTER the hull is parented and fitted, so the bounding box the flap
    // placement is measured from is the fitted one.
    airbrakes = createAirbrakes(next.root)
    lastAirbrake = Number.NaN
    lastBoosting = null
    lastThrottle = Number.NaN

    // Cache the glow materials once instead of traversing the hull every frame,
    // which is what the R3F build did.
    glowMaterials = []
    next.root.traverse(child => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh)
        return

      const materials = Array.isArray(mesh.material) ? mesh.material : [ mesh.material ]
      for (const material of materials)
        if (material?.name === 'Glow')
          glowMaterials.push(material as THREE.MeshStandardMaterial)
    })
  }

  return defineModule<RaceState>({
    name: 'ship-visual',

    build (ctx) {
      ctx.scene.add(shipRoot)

      if (handle)
        handle.current = {
          muzzleWorld (out) {
            out.length = 0
            return instance ? instance.cannons.muzzleWorld(out) : out
          },

          setHullVisible (visible) {
            if (visible === hullVisible)
              return
            hullVisible = visible
            if (instance)
              instance.root.visible = visible
          },

          setAimPitch (radians) {
            aimPitch = radians
            if (instance && changedBeyond(lastRenderedAim, radians, AIM_EPSILON)) {
              instance.root.rotation.x = -radians
              lastRenderedAim = radians
            }
          },

          updateVisual (delta, elapsed) {
            instance?.burner.update(delta, elapsed)
          },
        }
    },

    update (state) {
      const config = state.shipConfig
      if (!config)
        return

      if (config !== lastConfig) {
        const shipChanged = lastConfig?.shipId !== config.shipId
        lastConfig = config
        // A different hull needs a reload; anything else is just livery.
        if (shipChanged)
          void swapTo(config)
        else
          instance?.applyConfig(config)
      }

      if (changedBeyond(lastAirbrake, telemetry.airbrake, CONTROL_EPSILON)) {
        lastAirbrake = telemetry.airbrake
        airbrakes?.setDeploy(lastAirbrake)
      }

      // Pulse the engine glow while boosting.
      if (lastBoosting !== telemetry.boosting) {
        lastBoosting = telemetry.boosting

        const intensity = lastBoosting ? 3.6 : 1.6
        for (const material of glowMaterials)
          material.emissiveIntensity = intensity
      }

      // Plume tracks the throttle. The idle floor is deliberate: an engine that
      // goes fully dark on lift-off reads as a stall rather than a coast.
      const burner = instance?.burner
      if (burner) {
        const throttle = telemetry.boosting ? 1 : state.throttle ? 0.72 : 0.12
        if (changedBeyond(lastThrottle, throttle, CONTROL_EPSILON)) {
          lastThrottle = throttle
          burner.setThrottle(throttle)
        }
      }
    },

    dispose () {
      generation++ // orphan any in-flight load
      airbrakes?.dispose()
      airbrakes = null
      instance?.dispose()
      instance = null
      glowMaterials = []
      lastConfig = null
      lastRenderedAim = Number.NaN
      lastAirbrake    = Number.NaN
      lastBoosting    = null
      lastThrottle    = Number.NaN
      if (handle)
        handle.current = null
    },
  })
}
