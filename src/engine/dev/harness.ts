import * as THREE from 'three'
import { useRaceStore, raceTimers } from '@/hooks/use-race-store'
import { useStore } from '@/hooks/use-store'
import { useTuningStore } from '@/hooks/use-tuning-store'
import { STEP } from '@crash-velocity/physics/clock'
import { DEFAULT_TUNING } from '../state'
import type { ShipTuning } from '../state'
import { createLegend } from './legend'
import { createOverlays } from './overlay'
import { readDevParams } from './params'
import { installTrace, readTrace, recordFrame, watchContextLoss } from './trace'
import type { DevApi, DevDeps, OverlayFlags, TeleportArgs } from './types'


/**
 * The single inspection and control surface for the running game.
 *
 * Design rules, both driven by the fact that everything here is consumed
 * through `page.evaluate` from a CLI:
 *
 * 1. every method returns plain JSON — no THREE objects, no Rapier handles,
 *    which do not survive the structured clone across the CDP boundary;
 * 2. every method is cheap to *print*. Rounding happens here, not in the CLI,
 *    so an agent reading the output spends its context on the numbers rather
 *    than on seventeen digits of float noise.
 *
 * Replaces the ad-hoc `window.__race` object; that name is kept as an alias so
 * anything already typed into a devtools console keeps working.
 */

const API_VERSION = 1

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const _up      = new THREE.Vector3()
const _quat    = new THREE.Quaternion()
const _euler   = new THREE.Euler()

const round = (value: number, places = 3) => +value.toFixed(places)
type VType = { x: number; y: number; z: number }

const vec3  = (v: VType): [number, number, number] =>
  [ round(v.x), round(v.y), round(v.z) ]

/**
 * What the scene gets back. `onFrame` is the only thing the render phase has to
 * call — one hook rather than one per debug feature, so the production render
 * path stays a single `if`.
 */
export type DevHarness = {
  api: DevApi;
  onFrame (shipPosition: THREE.Vector3, frameDelta: number): void;
  detach (): void;
}

/**
 * What a dev build draws before anyone asks.
 *
 * `colliders` is deliberately NOT in here: it is the expensive layer, it redraws
 * the whole world's wireframe, and it hides the ship inside its own box.
 */
const DEFAULT_OVERLAYS: OverlayFlags = {
  rays:      true,
  forces:    true,
  netForce:  true,
  thrusters: true,
  com:       true,
  velocity:  true,
  inertia:   false,
  contacts:  false,
  path:      false,
  colliders: false,
  frustum:   false,
}

export function attachDevHarness (deps: DevDeps): DevHarness {
  installTrace()

  const { app, clock, controls, telemetry, vehicle, rig } = deps
  const overlays                                          = createOverlays(deps)
  const legend                                            = createLegend(rig.camera, app.ctx.scene)
  const params                                            = readDevParams()
  const detachers: Array<() => void>                      = [ overlays.dispose, legend.dispose ]

  // Number keys toggle one layer each, 0 clears the lot. Bound here rather than
  // in `input.ts` because `input.ts` ships and these do not.
  const onKey = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey)
      return

    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable))
      return

    if (event.key === '0') {
      const cleared: OverlayFlags = {}
      for (const layer of legend.layers)
        cleared[layer] = false
      overlays.set(cleared)
      return
    }

    const index = Number(event.key) - 1
    if (!Number.isInteger(index) || index < 0 || index >= legend.layers.length)
      return

    const layer = legend.layers[index]
    overlays.set({ [layer]: !overlays.flags()[layer] })
  }
  window.addEventListener('keydown', onKey)
  detachers.push(() => window.removeEventListener('keydown', onKey))

  const canvas = app.ctx.renderer.domElement
  if (canvas)
    detachers.push(watchContextLoss(canvas))

  let ready = false

  /** A synthetic frame for on-demand renders (step, screenshots). */
  const syntheticFrame = () => ({ delta: STEP, elapsed: clock.elapsed(), frame: 0 })

  function shipPose () {
    const body = vehicle.current?.body
    if (!body)
      return null

    const t = body.translation()
    const r = body.rotation()
    const v = body.linvel()
    const w = body.angvel()
    _quat.set(r.x, r.y, r.z, r.w)
    _up.copy(WORLD_UP).applyQuaternion(_quat)
    _euler.setFromQuaternion(_quat, 'YXZ')

    return {
      position:   vec3(t),
      quaternion: [ round(r.x), round(r.y), round(r.z), round(r.w) ] as [number, number, number, number],
      euler:      { pitch: round(_euler.x), yaw: round(_euler.y), roll: round(_euler.z) },
      linvel:     vec3(v),
      angvel:     vec3(w),
      up:         round(_up.dot(WORLD_UP)),
      speed:      round(Math.hypot(v.x, v.y, v.z), 2),
    }
  }

  const api: DevApi = {
    version: API_VERSION,
    level:   deps.levelId,
    seed:    deps.seed,
    raw:     deps,

    get ready () {
      return ready
    },

    probe () {
      const race     = useRaceStore.getState()
      const info     = app.ctx.renderer.info
      const debug    = vehicle.current?.debug ?? null
      const gameplay = useStore.getState()

      return {
        ok:      true,
        level:   deps.levelId,
        seed:    deps.seed,
        paused:  clock.paused,
        running: app.running,

        sim: {
          alpha:      round(clock.alpha(), 4),
          simElapsed: round(clock.elapsed(), 2),
          tick:       Math.round(clock.elapsed() / STEP),
          step:       STEP,
        },

        ship: shipPose(),

        telemetry: {
          speed:      round(telemetry.speed, 2),
          boostMeter: round(telemetry.boostMeter, 3),
          boosting:   telemetry.boosting,
          grounded:   telemetry.grounded,
          airbrake:   round(telemetry.airbrake, 3),
          crashSeq:   telemetry.crashSeq,
        },

        vehicle: debug && {
          racing:       debug.racing,
          engineForce:  round(debug.engineForce, 1),
          currentSpeed: round(debug.currentSpeed, 2),
          targetSpeed:  round(debug.targetSpeed, 2),
          contacts:     debug.contacts,
        },

        race: {
          status:         race.status,
          currentLap:     race.currentLap,
          laps:           race.laps,
          nextCheckpoint: race.nextCheckpoint,
          checkpoints:    race.checkpointCount,
          elapsed:        round(raceTimers.elapsed, 3),
          lapElapsed:     round(raceTimers.lapElapsed, 3),
          bestLap:        race.bestLap === null ? null : round(race.bestLap, 3),
          zone:           gameplay.zone,
        },

        input: {
          steer:    round(controls.steer, 3),
          strafe:   round(controls.strafe, 3),
          throttle: controls.throttle,
          brake:    controls.brake,
          boost:    controls.boost,
        },

        camera: { view: rig.view(), blend: round(rig.blend(), 3) },

        render: {
          drawCalls:  info.render.calls,
          triangles:  info.render.triangles,
          programs:   info.programs?.length ?? null,
          textures:   info.memory.textures,
          geometries: info.memory.geometries,
        },

        tuning:  useTuningStore.getState().tuning,
        overlay: overlays.flags(),
      }
    },

    pause () {
      clock.paused = true
      return { paused: true }
    },

    resume () {
      clock.paused = false
      return { paused: false }
    },

    /**
     * Advance exactly `n` sim ticks while frozen.
     *
     * The explicit render at the end is not optional: `app.tick` draws through
     * the root override, but a paused clock emits no sub-steps, so without a
     * forced draw a screenshot taken after `step()` still shows the pose from
     * before it.
     */
    step (n = 1) {
      const wasPaused  = clock.paused
      const wasRunning = app.running
      app.stop()
      clock.paused = false
      for (let i = 0; i < Math.max(1, n); i++)
        app.tick(STEP)
      clock.paused = true
      deps.renderOnce(syntheticFrame())
      if (wasRunning && !wasPaused)
        app.start()
      return api.probe()
    },

    /**
     * Cut the camera onto the ship instead of easing toward it.
     *
     * Required for reproducible screenshots. The sim is deterministic but the
     * camera rig is not: it damps toward the target on REAL frame deltas, so
     * the number of rAF frames that happened before a pause — which varies with
     * machine load — leaves it in a slightly different place every run. Snapping
     * collapses that to a single well-defined pose.
     */
    snapCamera () {
      rig.requestSnap()
      deps.renderOnce(syntheticFrame())
      return { view: rig.view(), blend: round(rig.blend(), 3) }
    },

    teleport (args: TeleportArgs) {
      const body = vehicle.current?.body
      if (!body)
        throw new Error('[dev] no vehicle body yet')

      if (args.position)
        body.setTranslation({ x: args.position[0], y: args.position[1], z: args.position[2] }, true)

      if (args.quaternion) {
        const [ x, y, z, w ] = args.quaternion
        body.setRotation({ x, y, z, w }, true)
      }
      else if (args.yaw !== undefined) {
        _quat.setFromEuler(_euler.set(0, args.yaw, 0))
        body.setRotation({ x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w }, true)
      }

      body.setLinvel(
        args.linvel ? { x: args.linvel[0], y: args.linvel[1], z: args.linvel[2] } : { x: 0, y: 0, z: 0 },
        true
      )
      body.setAngvel(
        args.angvel ? { x: args.angvel[0], y: args.angvel[1], z: args.angvel[2] } : { x: 0, y: 0, z: 0 },
        true
      )

      // Without this the renderer blends from the old pose and the ship visibly
      // smears across the level for one frame — and any screenshot taken
      // immediately after catches it mid-smear.
      vehicle.current?.interpolator?.teleport()
      rig.requestSnap()
      return api.probe()
    },

    setInput (patch) {
      for (const key of [ 'steer', 'strafe', 'throttle', 'brake', 'boost', 'panX', 'panY' ] as const)
        if (patch[key] !== undefined)
          (controls[key] as number | boolean) = patch[key]!
      return {
        steer:    controls.steer,
        strafe:   controls.strafe,
        throttle: controls.throttle,
        brake:    controls.brake,
        boost:    controls.boost,
      }
    },

    respawn () {
      controls.resetSeq++
    },

    toggleView () {
      controls.viewSeq++
      return rig.view()
    },

    setTuning (patch: Partial<ShipTuning>) {
      for (const [ key, value ] of Object.entries(patch))
        if (typeof value === 'number' && Number.isFinite(value))
          useTuningStore.getState().set(key as keyof ShipTuning, value)
      return useTuningStore.getState().tuning
    },

    resetTuning () {
      useTuningStore.getState().reset()
      return DEFAULT_TUNING
    },

    setStatus (status) {
      useRaceStore.setState({ status })
      return status
    },


    overlay (flags) {
      return overlays.set(flags)
    },

    trace () {
      return {
        ...readTrace(),
        level:  deps.levelId,
        status: useRaceStore.getState().status,
        ship:   shipPose(),
      }
    },
  }

  // --- boot-time URL overrides -------------------------------------------
  if (params.tuning)
    api.setTuning(params.tuning)
  // Physics layers are ON by default in dev. The whole point of drawing the
  // forces is that you see the wrong one without having gone looking for it, and
  // a layer you have to remember to switch on is a layer you find the bug
  // without. An explicit `?overlay=` still wins outright, including `?overlay=`
  // with nothing after it, which turns the lot off.
  api.overlay(
    Object.keys(params.overlay).length > 0 || params.overlayExplicit
      ? params.overlay
      : DEFAULT_OVERLAYS
  )
  if (params.paused)
    clock.paused = true
  window.__dev   = api
  window.__race  = api
  window.__three = THREE

  /**
   * Flip `ready` on the first RENDERED frame, not on a timer.
   *
   * A macrotask fires whether or not the sim has stepped, and the render phase
   * is the only place that runs after the vehicle module has both built and
   * updated. Gating on a timer instead made `probe()` intermittently return
   * `vehicle: null` and no wheel contacts — a partially-built scene that reads
   * exactly like a ship which has fallen through the world.
   */
  function markReady () {
    if (ready)
      return
    ready = true
  }

  detachers.push(() => {
    if (window.__dev === api) {
      delete window.__dev
      delete window.__race
    }
  })

  // `renderer.info` resets itself on every `render()` call, and the composer
  //  makes several per frame — so reading it straight gave the cost of the last
  //  post pass alone. It reported `drawCalls: 1` for every scene in the game,
  //  which is a useless number to try to optimise against. Accumulating instead,
  //  and resetting once per frame here, is the documented way to total a frame
  //  that renders more than once. Dev-only: nothing switches this on in a build.
  const info     = app.ctx.renderer.info
  info.autoReset = false
  detachers.push(() => {
    info.autoReset = true
  })

  return {
    api,

    onFrame (shipPosition, frameDelta) {
      markReady()
      overlays.update(shipPosition)
      legend.render(overlays.flags())

      // Read before the reset: at this point `info` holds every pass of the
      //  frame just drawn, because this runs ahead of the next `composer.render`.
      recordFrame({
        ms:        +(frameDelta * 1000).toFixed(2),
        speed:     telemetry.speed,
        grounded:  telemetry.grounded,
        drawCalls: info.render.calls,
      })
      info.reset()
    },

    detach () {
      for (const detach of detachers.reverse())
        detach()
    },
  }
}
