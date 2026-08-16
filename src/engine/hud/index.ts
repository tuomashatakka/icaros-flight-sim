import * as THREE from 'three'
import { defineModule } from 'threejs-scene'
import type { AppModule } from 'threejs-scene'
import { useRaceStore, raceTimers } from '@/hooks/use-race-store'
import type { RaceState } from '../state'
import type { Telemetry } from '../telemetry'
import type { LevelSpec } from '../levels/types'
import { createCockpitHud } from './cockpit-hud'
import { createChaseHud } from './chase-hud'
import { createNavMarker } from './nav-marker'
import type { HudFrame, HudRace } from './types'


export { HOLO } from './materials'
export type { HudFrame } from './types'

export type HudHandle = {

  /**
   * Draw one frame.
   *
   * Called from the RENDER phase, not from a module update: the HUD needs the
   * interpolated pose and the camera blend, both of which only exist there.
   */
  update(
    elapsed: number,
    shipPosition: THREE.Vector3,
    hullQuaternion: THREE.Quaternion,
    throttle: number,
    blend: number,
    camera: THREE.Camera,
    panX: number,
    panY: number
  ): void;
}

type HandleType = { current: HudHandle | null }

// Reused every frame; the race snapshot is a plain read, so there is no reason
// to allocate a new one 60 times a second.
const _race: HudRace = {
  status:     'idle',
  currentLap: 1,
  laps:       1,
  loop:       false,
  elapsed:    0,
  lapElapsed: 0,
  bestLap:    null,
}

const _frame = {} as HudFrame

/**
 * The in-scene holographic HUD.
 *
 * Two sets that cross-fade with the camera: a full canopy parented to the hull
 * for the cockpit, and a pared-back camera-locked strip for chase. Both are
 * additive emissive geometry with `toneMapped: false`, so the composer's
 * existing bloom lights them without a dedicated pass.
 *
 * State is read imperatively — `telemetry` directly at 60 Hz and
 * `useRaceStore.getState()` per frame. Subscribing would put a React commit in
 * the render path, which is the exact thing `publish`'s throttling exists to
 * avoid.
 */
export function hudModule (
  shipRoot: THREE.Group,
  level: LevelSpec,
  telemetry: Telemetry,
  handle: HandleType
): AppModule<RaceState> {
  const cockpit = createCockpitHud()
  const chase   = createChaseHud()
  const nav     = createNavMarker()

  return defineModule<RaceState>({
    name: 'hud',

    build (ctx) {
      shipRoot.add(cockpit.object)
      ctx.scene.add(chase.object)
      ctx.scene.add(nav.object)

      handle.current = {
        update (elapsed, shipPosition, hullQuaternion, throttle, blend, camera, panX, panY) {
          const state = useRaceStore.getState()

          _race.status     = state.status
          _race.currentLap = state.currentLap
          _race.laps       = state.laps
          _race.loop       = state.loop
          // Clocks come from the live object, not the store: the store copy is
          // throttled to 15 Hz for React's sake and would visibly stutter on a
          // readout showing milliseconds.
          _race.elapsed    = raceTimers.elapsed
          _race.lapElapsed = raceTimers.lapElapsed
          _race.bestLap    = state.bestLap

          const waypoints = level.waypoints
          const gate      = waypoints.length > 0
            ? waypoints[state.nextCheckpoint % waypoints.length] ?? null
            : null

          _frame.elapsed        = elapsed
          _frame.telemetry      = telemetry
          _frame.race           = _race
          _frame.shipPosition   = shipPosition
          _frame.hullQuaternion = hullQuaternion
          _frame.throttle       = throttle
          _frame.gate           = gate
          _frame.blend          = blend
          _frame.camera         = camera
          _frame.panX           = panX
          _frame.panY           = panY

          cockpit.update(_frame)
          chase.update(_frame)
          nav.update(gate, camera)
        },
      }
    },

    dispose () {
      handle.current = null
      cockpit.object.removeFromParent()
      chase.object.removeFromParent()
      nav.object.removeFromParent()
      cockpit.dispose()
      chase.dispose()
      nav.dispose()
    },
  })
}
