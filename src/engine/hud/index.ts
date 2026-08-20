import * as THREE from 'three'
import { defineModule } from 'threejs-scene'
import type { AppModule } from 'threejs-scene'
import { useBattleStore } from '@/hooks/use-battle-store'
import { raceTimers, useRaceStore } from '@/hooks/use-race-store'
import { useTuningStore } from '@/hooks/use-tuning-store'
import { useShipStore } from '@/hooks/use-ship-store'
import { useStore } from '@/hooks/use-store'
import { asSource } from '@/lib/tuning'
import { vehicleConfig } from '@/lib/utils'
import type { Controls } from '../input'
import type { LevelSpec } from '../levels/types'
import type { Telemetry } from '../telemetry'
import { createSpatialHud } from './spatial-hud'
import type { HudData, HudFrame, HudSource } from './types'


export type { HudFrame } from './types'

export type HudHandle = {
  update(
    elapsed: number,
    shipPosition: THREE.Vector3,
    hullQuaternion: THREE.Quaternion,
    throttle: number,
    cameraBlend: number,
    camera: THREE.Camera,
    panX: number,
    panY: number,
    aimPitch: number
  ): void;
}

type HandleType = { current: HudHandle | null }

type SharedHudOptions<TState extends object> = {
  canvas:    HTMLCanvasElement;
  telemetry: Telemetry;
  controls:  Controls;
  handle:    HandleType;
  source:    HudSource;
  target(frame: HudFrame): void;
}

function menu (): void {
  window.location.assign('/')
}

async function copyTuning (): Promise<void> {
  const value = asSource(useTuningStore.getState().tuning)
  try {
    await navigator.clipboard.writeText(value)
  }
  catch {
    // Clipboard is permission-gated on plain HTTP. The console keeps the tuned
    // values recoverable without adding a hidden DOM fallback outside canvas.
    console.info(value)
  }
}

function sharedHudModule<TState extends object> ({
  canvas,
  telemetry,
  controls,
  handle,
  source,
  target,
}: SharedHudOptions<TState>): AppModule<TState> {
  const spatial         = createSpatialHud({ canvas, controls, source })
  const frame: HudFrame = {
    elapsed:          0,
    telemetry,
    shipPosition:     new THREE.Vector3(),
    hullQuaternion:   new THREE.Quaternion(),
    throttle:         0,
    cameraBlend:      0,
    camera:           new THREE.PerspectiveCamera(),
    panX:             0,
    panY:             0,
    aimPitch:         0,
    steer:            0,
    strafe:           0,
    brake:            false,
    boost:            false,
    target:           null,
    targetLabel:      '',
    checkpointNumber: 0,
    checkpointCount:  0,
  }

  return defineModule<TState>({
    name: 'spatial-cockpit-hud',

    build (context) {
      context.scene.add(spatial.object)
      handle.current = {
        update (
          elapsed,
          shipPosition,
          hullQuaternion,
          throttle,
          cameraBlend,
          camera,
          panX,
          panY,
          aimPitch
        ) {
          frame.elapsed        = elapsed
          frame.shipPosition   = shipPosition
          frame.hullQuaternion = hullQuaternion
          frame.throttle       = throttle
          frame.cameraBlend    = cameraBlend
          frame.camera         = camera
          frame.panX           = panX
          frame.panY           = panY
          frame.aimPitch       = aimPitch
          frame.steer          = controls.steer
          frame.strafe         = controls.strafe
          frame.brake          = controls.brake
          frame.boost          = controls.boost
          target(frame)
          spatial.update(frame)
        },
      }
    },

    dispose () {
      handle.current = null
      spatial.dispose()
    },
  })
}

export function raceHudModule<TState extends object> (
  canvas: HTMLCanvasElement,
  level: LevelSpec,
  telemetry: Telemetry,
  controls: Controls,
  handle: HandleType
): AppModule<TState> {
  const source: HudSource = {
    mode: 'race',
    read (): HudData {
      const tuning = useTuningStore.getState()
      const game   = useStore.getState()
      const level  = game.speedLevels.find(entry => entry.zone === game.zone) ?? game.speedLevels.at(-1)
      return {
        mode:   'race',
        race:   useRaceStore.getState(),
        clocks: {
          elapsed:    raceTimers.elapsed,
          lapElapsed: raceTimers.lapElapsed,
          countdown:  raceTimers.countdown,
        },
        tuning:      tuning.tuning,
        tuningOpen:  tuning.open,
        shipId:      useShipStore.getState().currentConfig.shipId,
        zone:        game.zone,
        targetSpeed: Math.min(level?.speedTarget ?? vehicleConfig.maxSpeed, vehicleConfig.maxSpeed),
      }
    },
    actions: {
      menu,
      raceAgain:    () => useRaceStore.getState().resetRace(),
      toggleTuning: () => {
        const store = useTuningStore.getState()
        store.setOpen(!store.open)
      },
      resetTuning: () => useTuningStore.getState().reset(),
      copyTuning,
      setTuning:   (key, value) => useTuningStore.getState().set(key, value),
      clearToast () {},
    },
  }

  return sharedHudModule<TState>({
    canvas,
    telemetry,
    controls,
    handle,
    source,
    target (frame) {
      const race             = useRaceStore.getState()
      const waypoints        = level.waypoints
      const index            = waypoints.length > 0 ? race.nextCheckpoint % waypoints.length : 0
      frame.target           = waypoints[index] ?? null
      frame.targetLabel      = level.id.toUpperCase()
      frame.checkpointNumber = waypoints.length > 0 ? index + 1 : 0
      frame.checkpointCount  = waypoints.length
    },
  })
}

export function battleHudModule<TState extends object> (
  canvas: HTMLCanvasElement,
  telemetry: Telemetry,
  controls: Controls,
  handle: HandleType
): AppModule<TState> {
  const source: HudSource = {
    mode:    'battle',
    read:    () => ({ mode: 'battle', battle: useBattleStore.getState() }),
    actions: {
      menu,
      raceAgain () {},
      toggleTuning () {},
      resetTuning () {},
      copyTuning: async () => {},
      setTuning () {},
      clearToast: key => useBattleStore.getState().clearToast(key),
    },
  }

  return sharedHudModule<TState>({
    canvas,
    telemetry,
    controls,
    handle,
    source,
    target (frame) {
      frame.target           = null
      frame.targetLabel      = 'APEX ARENA'
      frame.checkpointNumber = 0
      frame.checkpointCount  = 0
    },
  })
}

// perf: one shared module instance per mounted scene; state stores are sampled only when textures redraw.
