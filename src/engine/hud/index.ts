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
import type { TrackSpec } from '@crash-velocity/race'
import type { Telemetry } from '../telemetry'
import { createSpatialHud } from './spatial-hud'
import { LOCK } from '@crash-velocity/battle/weapons'
import type { HudData, HudFrame, HudSight, HudSource, HudViewFrame } from './types'


export type { HudFrame, HudSight, HudViewFrame } from './types'

export type HudHandle = {
  update(view: HudViewFrame): void;
}

type HandleType = { current: HudHandle | null }

type SharedHudOptions<TState extends object> = {
  canvas:    HTMLCanvasElement;
  telemetry: Telemetry;
  controls:  Controls;
  handle:    HandleType;
  source:    HudSource;

  /** The route's `touch` parameter, from the page's `useSearchParams`. */
  forcedTouch?: string | null;
  target(frame: HudFrame): void;
}

/**
 * Mean distance between consecutive gates, metres.
 *
 * Computed once per mount: the waypoints are level data and do not move, and
 * this is what the closure bar is normalised against so a tight track reads
 * differently from a 600-unit sprint.
 */
function averageGateSpacing (track: TrackSpec): number {
  const points = track.waypoints
  if (points.length < 2)
    return 600

  // Plain tuples rather than `Vector3` — a track is serialisable now, because
  //  the server builds the same one without three.js.
  let total = 0
  for (let i = 1; i < points.length; i++)
    total += Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1],
      points[i][2] - points[i - 1][2],
    )
  return Math.max(1, total / (points.length - 1))
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
  forcedTouch,
  target,
}: SharedHudOptions<TState>): AppModule<TState> {
  const spatial         = createSpatialHud({ canvas, controls, source, forcedTouch })
  const frame: HudFrame = {
    elapsed:          0,
    telemetry,
    shipPosition:     new THREE.Vector3(),
    hullQuaternion:   new THREE.Quaternion(),
    throttle:         0,
    cameraBlend:      0,
    camera:           new THREE.PerspectiveCamera(),
    hudQuaternion:    new THREE.Quaternion(),
    hudLead:          new THREE.Quaternion(),
    aimPitch:         0,
    steer:            0,
    strafe:           0,
    target:           null,
    targetLabel:      '',
    checkpointNumber: 0,
    checkpointCount:  0,
    gateSpacing:      600,
    sight:            null,
  }

  return defineModule<TState>({
    name: 'spatial-cockpit-hud',

    build (context) {
      context.scene.add(spatial.object)
      handle.current = {
        update (view) {
          frame.elapsed        = view.elapsed
          frame.shipPosition   = view.shipPosition
          frame.hullQuaternion = view.hullQuaternion
          frame.throttle       = view.throttle
          frame.cameraBlend    = view.cameraBlend
          frame.camera         = view.camera
          frame.hudQuaternion.copy(view.hudQuaternion)
          frame.hudLead.copy(view.hudLead)
          frame.aimPitch = view.aimPitch
          frame.steer    = controls.steer
          frame.strafe   = controls.strafe
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

const _target = new THREE.Vector3()

export function raceHudModule<TState extends object> (
  canvas: HTMLCanvasElement,
  track: TrackSpec,
  telemetry: Telemetry,
  controls: Controls,
  handle: HandleType,
  forcedTouch?: string | null
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
      // A client cannot restart a race any more — the server owns it. Rejoining
      // is the honest equivalent, and it is what the room does on a finish.
      raceAgain:    () => globalThis.location?.reload(),
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

  const gateSpacing = averageGateSpacing(track)

  return sharedHudModule<TState>({
    canvas,
    telemetry,
    controls,
    handle,
    source,
    forcedTouch,
    target (frame) {
      const race      = useRaceStore.getState()
      const waypoints = track.waypoints
      const index     = waypoints.length > 0 ? race.nextCheckpoint % waypoints.length : 0
      const point     = waypoints[index]

      // Waypoints are plain tuples now — a track is serialisable, because it
      // goes over the wire on join — so the marker is built here rather than
      // held as a `Vector3` the sim would have had to carry.
      frame.target           = point ? _target.set(point[0], point[1], point[2]) : null
      frame.targetLabel      = track.id.toUpperCase()
      frame.checkpointNumber = waypoints.length > 0 ? index + 1 : 0
      frame.checkpointCount  = waypoints.length
      frame.gateSpacing      = gateSpacing
      // No guns in race; the sight draws an attitude reference instead.
      frame.sight            = null
    },
  })
}

/**
 * @param readSight - Where the guns point and what the shot hits, or null while
 * the predicted chassis does not exist yet. Supplied by the scene because only
 * it has the predicted pose, the weapon's reach and a rapier world to ask.
 */
export function battleHudModule<TState extends object> (
  canvas: HTMLCanvasElement,
  telemetry: Telemetry,
  controls: Controls,
  handle: HandleType,
  readSight: () => HudSight | null,
  forcedTouch?: string | null
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
    forcedTouch,
    target (frame) {
      const battle = useBattleStore.getState()
      const locked = battle.lockOn.targetId !== null

      // `target` used to be hardcoded null with the label pinned to the arena
      // name, so every range readout in battle showed zero and the reticle
      // label always fell through to FREE VECTOR.
      frame.sight            = readSight()
      frame.target           = locked ? frame.sight?.impact ?? null : null
      frame.targetLabel      = locked ? battle.lockOn.name?.toUpperCase() ?? 'CONTACT' : 'APEX ARENA'
      frame.checkpointNumber = 0
      frame.checkpointCount  = 0
      frame.gateSpacing      = LOCK.range
    },
  })
}

// perf: one shared module instance per mounted scene; state stores are sampled only when textures redraw.
