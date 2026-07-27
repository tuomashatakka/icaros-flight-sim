import * as THREE from 'three'
import { createApp, createSeededRng, defineModule } from 'threejs-scene'
import type { App } from 'threejs-scene'
import { standardLighting } from 'threejs-scene/modules/lighting'
import { postProcessing } from 'threejs-scene/modules/post'
import { useRaceStore } from '@/hooks/use-race-store'
import { initRapier } from '../rapier'
import { createSimClock } from '../clock'
import { createPhysics } from '../physics/world'
import { attachBoxColliders } from '../physics/colliders'
import { createTelemetry } from '../telemetry'
import { createControls, attachControls } from '../input'
import { createChaseRig } from '../camera/rig'
import { vehicleModule } from '../modules/vehicle'
import type { VehicleHandle } from '../modules/vehicle'
import { physicsStepModule } from '../modules/physics-step'
import { raceModule } from '../modules/race'
import { shipVisualModule } from '../modules/ship-visual'
import { sunModule } from '../modules/sun'
import type { SunHandle } from '../modules/sun'
import { publishModule } from '../modules/publish'
import { attachBridge } from '../bridge'
import { initialRaceState } from '../state'
import type { RaceState } from '../state'
import { flatsLevel } from '../levels/flats'
import { neonCanyonLevel } from '../levels/neon-canyon'
import { orbitalRingLevel } from '../levels/orbital-ring'
import { proceduralLevel } from '../levels/procedural'
import type { LevelId, LevelSpec } from '../levels/types'


const LEVEL_BUILDERS: Record<LevelId, () => LevelSpec> = {
  'flats':        flatsLevel,
  'neon-canyon':  neonCanyonLevel,
  'orbital-ring': orbitalRingLevel,
  'procedural':   proceduralLevel,
}

const SEED = 7

// Hoisted — sampled once per rendered frame.
const _shipPosition   = new THREE.Vector3()
const _shipQuaternion = new THREE.Quaternion()

/**
 * The race scene composition root.
 *
 * Mirrors the reference template's `mount(canvas)` shape. The rapier world and
 * the clock are built here, before `createApp`, and injected — a module cannot
 * own the world because `createApp` builds and updates modules from the same
 * ordered array, so "built first, stepped last" is unsatisfiable.
 */
export async function mountRace (
  canvas: HTMLCanvasElement,
  levelId: LevelId
): Promise<App<RaceState>> {
  const RAPIER = await initRapier()

  const builder = LEVEL_BUILDERS[levelId] ?? flatsLevel
  const level   = builder()

  const physics   = createPhysics(RAPIER)
  const clock     = createSimClock()
  const telemetry = createTelemetry()
  const controls  = createControls()
  type VehicleType = { current: VehicleHandle | null }

  const vehicle: VehicleType = { current: null }
  type SunType = { current: SunHandle | null }

  const sun: SunType         = { current: null }

  // The composer does not exist at composition time — the effects callback hands
  // it back later, so the root render override reaches it through this binding.
  let composer: { render(delta: number): void } | null = null

  // The rig is built BEFORE createApp and passed in as `camera`. createApp binds
  // the camera to its resize observer at construction, so swapping ctx.camera
  // afterwards would leave the rig's aspect uncorrected on every resize. It gets
  // its own seeded stream from the same seed so replays stay deterministic.
  const rng = createSeededRng(SEED)
  const rig = createChaseRig(rng)

  // Placeholder hull until the ship loader lands. The interpolated pose is
  // written to this root each rendered frame; a real ship will hang its fitted
  // model underneath so scale never fights the per-frame transform.
  const shipRoot = new THREE.Group()

  // Gate crossings arrive as collider-handle pairs, so the race module needs a
  // way to tell the ship from scenery. Resolved lazily — the chassis collider
  // only exists once the vehicle module has built.
  const isVehicleCollider = (handle: number) => {
    const body = vehicle.current?.body
    if (!body)
      return false
    for (let i = 0; i < body.numColliders(); i++)
      if (body.collider(i).handle === handle)
        return true
    return false
  }

  const race = raceModule(physics, level, isVehicleCollider)

  const app = createApp<RaceState>(canvas, {
    state:    initialRaceState(),
    seed:     SEED,
    clock,
    camera:   rig.camera,
    scene:    { background: level.background },
    renderer: { shadows: true },

    use: [
      // Kept dim on purpose: each level adds its own hemisphere and point
      // lights (ported from the R3F versions), so this is a base layer, not the
      // whole key. The env map exists mainly so metalness/clearcoat aren't
      // silent no-ops. `sun: false` — the shadow-casting key is our own module
      // below, because a fixed shadow camera loses the ship entirely once it
      // drives past the frustum.
      standardLighting<RaceState>({
        env:  { intensity: 0.22 },
        sun:  { intensity: 0 },
        hemi: { skyColor: '#8a9bff', groundColor: '#0a0c14', intensity: 0.2 },
      }),

      sunModule(sun, { intensity: 1.6, frustum: 45, mapSize: 2048 }),

      // Level geometry + its static collider strip.
      defineModule<RaceState>({
        name: `level:${level.id}`,
        build (ctx) {
          level.build(ctx, physics)
          attachBoxColliders(physics, level.colliders, level.colliderOffset)
        },
      }),

      shipVisualModule(shipRoot, telemetry),

      // Reads input into state. Input is written by DOM listeners onto a plain
      // object; this is the one place it enters the unidirectional flow.
      defineModule<RaceState>({
        name: 'input-sync',
        build () {},
        update (_state, _frame, _ctx) {
          app.setState({
            steer:    controls.steer,
            throttle: controls.throttle,
            brake:    controls.brake,
            boost:    controls.boost,
            resetSeq: controls.resetSeq,
          })
        },
      }),

      race,
      vehicleModule(physics, telemetry, vehicle, () => rig.requestSnap()),
      // Drains gate crossings straight into the race module's handler.
      physicsStepModule(physics, race.handleCollision),
      publishModule(telemetry),

      // Feed the accumulated impact shake to the rig, then clear it.
      defineModule<RaceState>({
        name: 'impact',
        build () {},
        update () {
          if (telemetry.shake > 0) {
            rig.shake(telemetry.shake)
            telemetry.shake = 0
          }
        },
      }),

      // Must be LAST: the last-mounted module with a render hook wins, and this
      // one owns the composer we drive from the root render override.
      postProcessing<RaceState>({
        bloom:   level.bloom,
        effects: ctx => {
          composer = ctx.composer
          return []
        },
      }),
    ],

    // Interpolation and the camera live here, not in a module: exactly one
    // render owner runs per frame and `postProcessing` claims it, so the root
    // override is the only hook guaranteed to run once per REAL frame.
    render (frame) {
      const interpolator = vehicle.current?.interpolator
      if (interpolator) {
        // Blend the last two solved poses. Both the hull and the camera read
        // this, never the raw body, or they stair-step above 60 Hz.
        interpolator.sample(clock.alpha(), _shipPosition, _shipQuaternion)
        shipRoot.position.copy(_shipPosition)
        shipRoot.quaternion.copy(_shipQuaternion)
        rig.drive(frame.delta, _shipPosition, _shipQuaternion)
        // Keep the shadow volume on the ship, or it drives out of it.
        sun.current?.follow(_shipPosition)
      }

      if (composer)
        composer.render(frame.delta)
      else
        app.ctx.renderer.render(app.ctx.scene, rig.camera)
    },
  })

  const detachControls = attachControls(canvas, controls)
  const detachBridge   = attachBridge(app)

  // Dev handle: lets the physics be inspected and driven from devtools, and
  // makes `alpha`, ride height and tick drift observable rather than inferred.
  if (process.env.NODE_ENV !== 'production')
    (window as unknown as Record<string, unknown>).__race = {
      app,
      physics,
      telemetry,
      controls,
      clock,
      rig,
      vehicle,
      level,
      raceStore: useRaceStore,
      probe () {
        const body = vehicle.current?.body
        const t    = body?.translation()
        const lv   = body?.linvel()
        return {
          alpha:      +clock.alpha().toFixed(4),
          simElapsed: +clock.elapsed().toFixed(2),
          y:          t ? +t.y.toFixed(3) : null,
          speed:      lv ? +Math.hypot(lv.x, lv.y, lv.z).toFixed(2) : null,
          grounded:   telemetry.grounded,
          status:     app.getState().status,
        }
      },
    }

  const dispose = app.dispose
  app.dispose   = () => {
    detachControls()
    detachBridge()
    composer = null
    dispose()
    // After the modules: they call world.removeRigidBody in their own dispose,
    // so the world has to outlive them.
    physics.free()
  }

  return app
}
