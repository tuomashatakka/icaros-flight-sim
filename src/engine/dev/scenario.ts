import * as THREE from 'three'
import { useRaceStore } from '@/hooks/use-race-store'
import { useTuningStore } from '@/hooks/use-tuning-store'
import { STEP } from '../clock'
import { resetTelemetry } from '../telemetry'
import type { Controls } from '../input'
import type {
  DevDeps,
  ScenarioEvent,
  ScenarioSample,
  ScenarioScript,
  ScenarioSummary,
  ScenarioTrace,
} from './types'


/**
 * Deterministic scripted runs.
 *
 * This is the whole reason the dev layer exists. The sim is deterministic by
 * construction — fixed `STEP`, seeded rng forked per subsystem, no `Math.random`
 * anywhere inside the tick — so the same script produces the same trace byte for
 * byte. That turns "the ship flips at the second corner" from an anecdote into a
 * reproducible artefact you can diff across a refactor.
 *
 * Runs are non-destructive: the live clock, controls and body pose are captured
 * up front and restored afterwards, so poking a scenario from devtools mid-race
 * does not eat the race.
 */

/** Sim ticks between yields to the event loop, so the tab is never declared hung. */
const YIELD_INTERVAL = 300

/** Hard ceiling on a single run — a bad `duration` should fail fast, not wedge the page. */
const MAX_TICKS = 60 * 60 * 5

const WORLD_UP = new THREE.Vector3(0, 1, 0)
const _up      = new THREE.Vector3()
const _quat    = new THREE.Quaternion()
const _euler   = new THREE.Euler()

const round = (value: number, places = 3) => +value.toFixed(places)

// ------------------------------------------------------------------ *
// Failure thresholds — the assertion surface.
//
// These four constants define what "broken handling" means for this ship, and
// every future regression check reads them indirectly through `summary`. They
// are deliberately constants rather than inline literals so retuning the ship
// does not mean re-deriving them from the summariser's control flow.
// ------------------------------------------------------------------

/** Below this dot product the ship is on its side or worse. */
const FLIP_UP_THRESHOLD = 0.35

/**
 * Consecutive samples below {@link FLIP_UP_THRESHOLD} before it counts as a
 * flip. A single sample is a kerb strike or a barrel roll off a jump — the
 * upright control recovers from those by design, and calling them failures
 * would make every jump scenario red.
 */
const FLIP_PERSISTENCE = 3

/** Below this Y the ship has left the track surface downward — the fall-through canary. */
const FALL_THROUGH_Y = -5

/**
 * Ticks run with neutral input before the timeline starts.
 *
 * One second is comfortably past the point where the suspension settles, and it
 * costs ~2 ms — cheap insurance against a whole run being unreproducible.
 */
const SETTLE_TICKS = 60

/** Speed under which the ship is treated as not really moving, for `avgSpeed`. */
const IDLE_SPEED = 0.5

/**
 * Reduce a run to the numbers that indicate broken handling.
 *
 * `minY` is the fall-through canary rather than `airborneRatio`: this ship is
 * *supposed* to leave the ground constantly, so a high airborne ratio is a
 * level-design signal, not a fault — whereas a Y below the track means it went
 * through a collider, which is always a bug (see the box-collider note in the
 * project history).
 */
export function summarise (samples: ScenarioSample[], events: ScenarioEvent[]): ScenarioSummary {
  let maxSpeed = 0
  let speedSum = 0
  let moving   = 0
  let minY     = Infinity
  let maxY     = -Infinity
  let minUp    = Infinity
  let airborne = 0
  let distance = 0
  let belowRun = 0
  let flipped  = false

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    maxSpeed = Math.max(maxSpeed, s.v)
    minY     = Math.min(minY, s.p[1])
    maxY     = Math.max(maxY, s.p[1])
    minUp    = Math.min(minUp, s.up)

    if (s.v > IDLE_SPEED) {
      speedSum += s.v
      moving++
    }
    if (!s.grounded)
      airborne++

    belowRun = s.up < FLIP_UP_THRESHOLD ? belowRun + 1 : 0
    if (belowRun >= FLIP_PERSISTENCE)
      flipped = true

    if (i > 0) {
      const p = samples[i - 1].p
      distance += Math.hypot(s.p[0] - p[0], s.p[1] - p[1], s.p[2] - p[2])
    }
  }

  return {
    maxSpeed:      round(maxSpeed, 2),
    avgSpeed:      round(moving ? speedSum / moving : 0, 2),
    minY:          round(samples.length ? minY : 0, 3),
    maxY:          round(samples.length ? maxY : 0, 3),
    minUp:         round(samples.length ? minUp : 1, 3),
    flipped,
    fellThrough:   samples.length > 0 && minY < FALL_THROUGH_Y,
    airborneRatio: round(samples.length ? airborne / samples.length : 0, 3),
    crashes:       events.filter(e => e.type === 'crash').length,
    gatesPassed:   events.filter(e => e.type === 'gate').length,
    finished:      events.some(e => e.type === 'finish'),
    distance:      round(distance, 1),
  }
}

/** Apply a timeline entry's inputs onto the live controls object. */
function applyInput (controls: Controls, input: Partial<Controls> | undefined) {
  if (!input)
    return
  for (const key of [ 'steer', 'strafe', 'throttle', 'brake', 'boost' ] as const)
    if (input[key] !== undefined)
      (controls[key] as number | boolean) = input[key]!
}

export async function runScenario (deps: DevDeps, script: ScenarioScript): Promise<ScenarioTrace> {
  const { app, clock, controls, telemetry, vehicle } = deps

  const duration    = Math.max(0, script.duration)
  const sampleEvery = script.sampleEvery ?? 0.25
  const totalTicks  = Math.min(MAX_TICKS, Math.round(duration / STEP))
  const sampleTicks = Math.max(1, Math.round(sampleEvery / STEP))

  const body = vehicle.current?.body
  if (!body)
    throw new Error('[dev] scenario needs a built vehicle — is the scene still loading?')

  // --- capture everything we are about to disturb -------------------------
  const wasRunning  = app.running
  const wasPaused   = clock.paused
  const savedInput  = { ...controls }
  const savedTuning = { ...useTuningStore.getState().tuning }
  const savedPose   = {
    t: { ...body.translation() },
    r: { ...body.rotation() },
    v: { ...body.linvel() },
    w: { ...body.angvel() },
  }

  if (script.tuning)
    for (const [ key, value ] of Object.entries(script.tuning))
      useTuningStore.getState().set(key as keyof typeof savedTuning, value as number)

  // Take the rAF loop out of the picture entirely, then stop rendering. The
  // second part is the turbo: physics at 1/60 costs microseconds, the composer
  // costs milliseconds, so skipping the draw is what buys ~300x real time.
  app.stop()
  clock.paused = false
  deps.setSkipRender(true)

  // ALWAYS establish a known initial condition, even when the script gives no
  // `start`. Without this a run inherits whatever pose the ship drifted into
  // while the page was loading — which depends on how many real frames elapsed
  // before the scenario was invoked, and is therefore machine- and load-
  // dependent. On flats that settles to rest and hides the problem; on
  // neon-canyon the ship is still moving and the same script produced a 20%
  // different top speed between runs.
  const spawn = useRaceStore.getState().spawn
  const p     = script.start?.position ?? spawn.position
  body.setTranslation({ x: p[0], y: p[1], z: p[2] }, true)

  if (script.start?.yaw !== undefined) {
    _quat.setFromEuler(_euler.set(0, script.start.yaw, 0))
    body.setRotation({ x: _quat.x, y: _quat.y, z: _quat.z, w: _quat.w }, true)
  }
  else {
    const [ x, y, z, w ] = spawn.quaternion
    body.setRotation({ x, y, z, w }, true)
  }

  const v = script.start?.linvel
  body.setLinvel({ x: v?.[0] ?? 0, y: v?.[1] ?? 0, z: v?.[2] ?? 0 }, true)
  body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  vehicle.current?.interpolator?.teleport()

  // Settle before the clock starts.
  //
  // Resetting the pose is not sufficient for reproducibility: rapier keeps
  // warm-start impulses and the vehicle controller keeps per-wheel suspension
  // state, both carried over from however long the page happened to run live
  // before the scenario was invoked. Stepping with neutral input from a fixed
  // pose drives that hidden state to the same equilibrium every time. These
  // ticks are outside the timeline — `t = 0` is the first sampled tick.
  controls.steer    = 0
  controls.strafe   = 0
  controls.pitch    = 0
  controls.throttle = false
  controls.brake    = false
  controls.boost    = false

  const settleTicks = script.settleTicks ?? SETTLE_TICKS
  for (let i = 0; i < settleTicks; i++)
    app.tick(STEP)
  if (script.start?.linvel) {
    // Settling bleeds off the requested entry velocity, so restore it after.
    body.setLinvel({ x: v![0], y: v![1], z: v![2] }, true)
    vehicle.current?.interpolator?.teleport()
  }

  // Reset the race machine as well as the body. The store's `respawn` target is
  // the last checkpoint cleared, and lap/gate counters advance during the live
  // session — so a scenario that respawns, or one whose events are gate-based,
  // is only reproducible if this starts from lap 1 with the spawn as the
  // respawn target.
  // Reset every piece of mutable state the sim carries between runs. Each of
  // these was found the same way: the same script produced different traces
  // until it was reset. Telemetry is the sneakiest — `boostMeter` drains during
  // the live session and never refills on its own.
  resetTelemetry(telemetry)
  deps.publish.current?.reset()

  if (script.autoStart !== false) {
    useRaceStore.getState().resetRace()
    useRaceStore.setState({ status: 'racing' })
  }

  const samples: ScenarioSample[] = []
  const events: ScenarioEvent[]   = []

  const timeline = [ ...script.timeline ].sort((a, b) => a.at - b.at)
  let nextEntry  = 0

  let seenCrashes = telemetry.crashSeq
  let lastGate    = useRaceStore.getState().nextCheckpoint
  let lastStatus  = useRaceStore.getState().status
  const wallStart = performance.now()

  try {
    for (let tick = 0; tick <= totalTicks; tick++) {
      const t = tick * STEP

      while (nextEntry < timeline.length && timeline[nextEntry].at <= t) {
        const entry = timeline[nextEntry++]
        applyInput(controls, entry.input)
        if (entry.respawn) {
          controls.resetSeq++
          events.push({ t: round(t), type: 'respawn' })
        }
      }

      app.tick(STEP)

      // Edge-detect sim outputs. Crashes are a monotonic counter for exactly
      // this reason — a boolean would be missed between samples.
      while (seenCrashes < telemetry.crashSeq) {
        seenCrashes++
        events.push({ t: round(t), type: 'crash' })
      }

      const race = useRaceStore.getState()
      if (race.nextCheckpoint !== lastGate) {
        events.push({ t: round(t), type: 'gate', index: lastGate })
        lastGate = race.nextCheckpoint
      }
      if (race.status !== lastStatus) {
        if (race.status === 'finished')
          events.push({ t: round(t), type: 'finish' })
        lastStatus = race.status
      }

      if (tick % sampleTicks === 0) {
        const p = body.translation()
        const r = body.rotation()
        const v = body.linvel()
        _quat.set(r.x, r.y, r.z, r.w)
        _up.copy(WORLD_UP).applyQuaternion(_quat)
        _euler.setFromQuaternion(_quat, 'YXZ')

        samples.push({
          t:        round(t, 2),
          p:        [ round(p.x), round(p.y), round(p.z) ],
          yaw:      round(_euler.y),
          v:        round(Math.hypot(v.x, v.y, v.z), 2),
          up:       round(_up.dot(WORLD_UP)),
          grounded: telemetry.grounded,
        })
      }

      if (tick % YIELD_INTERVAL === 0)
        await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
  finally {
    // Restore in reverse order of disturbance, and unconditionally — a throw
    // mid-run must not leave the page frozen with rendering disabled.
    deps.setSkipRender(false)
    Object.assign(controls, savedInput)
    body.setTranslation(savedPose.t, true)
    body.setRotation(savedPose.r, true)
    body.setLinvel(savedPose.v, true)
    body.setAngvel(savedPose.w, true)
    vehicle.current?.interpolator?.teleport()
    for (const [ key, value ] of Object.entries(savedTuning))
      useTuningStore.getState().set(key as keyof typeof savedTuning, value)
    clock.paused = wasPaused
    if (wasRunning)
      app.start()
  }

  return {
    name:    script.name ?? 'unnamed',
    seed:    script.seed ?? deps.seed,
    level:   deps.levelId,
    ticks:   totalTicks,
    wallMs:  Math.round(performance.now() - wallStart),
    samples,
    events,
    summary: summarise(samples, events),
  }
}
