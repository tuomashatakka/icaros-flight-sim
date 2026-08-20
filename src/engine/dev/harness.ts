import * as THREE from 'three'
import { useRaceStore, raceTimers } from '@/hooks/use-race-store'
import { useStore } from '@/hooks/use-store'
import { useTuningStore } from '@/hooks/use-tuning-store'
import { STEP } from '../clock'
import { DEFAULT_TUNING } from '../state'
import type { ShipTuning } from '../state'
import { createOverlays } from './overlay'
import { readDevParams } from './params'
import { runScenario } from './scenario'
import { installTrace, readTrace, recordFrame, watchContextLoss } from './trace'
import type { DevApi, DevDeps, ScenarioScript, TeleportArgs } from './types'


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

export function attachDevHarness (deps: DevDeps): DevHarness {
  installTrace()

  const { app, clock, controls, telemetry, vehicle, rig } = deps
  const overlays                                          = createOverlays(deps)
  const params                                            = readDevParams()
  const detachers: Array<() => void>                      = [ overlays.dispose ]

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
    version:      API_VERSION,
    level:        deps.levelId,
    seed:         deps.seed,
    lastScenario: null,
    raw:          deps,

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

    async scenario (script) {
      const trace      = await runScenario(deps, script)
      api.lastScenario = trace
      return trace
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
  if (Object.keys(params.overlay).length > 0)
    api.overlay(params.overlay)
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

    // `?scenario=<name>` runs a bundled script on boot and parks the trace on
    // `__dev.lastScenario`, so a reproduction can be a URL you paste into a
    // browser as easily as a CLI invocation.
    if (params.scenario)
      void fetch(`/scenarios/${params.scenario}.json`)
        .then(response => response.json() as Promise<ScenarioScript>)
        .then(script => api.scenario(script))
        .catch(cause => console.error('[dev] ?scenario= failed', cause))
  }

  detachers.push(() => {
    if (window.__dev === api) {
      delete window.__dev
      delete window.__race
    }
  })

  return {
    api,

    onFrame (shipPosition, frameDelta) {
      markReady()
      overlays.update(shipPosition)
      recordFrame({
        ms:        +(frameDelta * 1000).toFixed(2),
        speed:     telemetry.speed,
        grounded:  telemetry.grounded,
        drawCalls: app.ctx.renderer.info.render.calls,
      })
    },

    detach () {
      for (const detach of detachers.reverse())
        detach()
    },
  }
}
