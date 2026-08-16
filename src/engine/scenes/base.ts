import * as THREE from 'three'
import { createApp, createSeededRng, defineModule } from 'threejs-scene'
import type { App, AppModule, FrameContext } from 'threejs-scene'
import { standardLighting } from 'threejs-scene/modules/lighting'
import { postProcessing } from 'threejs-scene/modules/post'
import { useCameraView } from '@/hooks/use-camera-view'
import { initRapier } from '../rapier'
import { createSimClock } from '../clock'
import { createPhysics } from '../physics/world'
import type { Physics } from '../physics/world'
import { attachBoxColliders } from '../physics/colliders'
import type { BoxCollider } from '@/lib/track/build-track'
import { createTelemetry } from '../telemetry'
import type { Telemetry } from '../telemetry'
import { createControls, attachControls } from '../input'
import type { Controls } from '../input'
import { createCameraRig } from '../camera/rig'
import type { CameraRig } from '../camera/rig'
import type { HudHandle } from '../hud'
import { vehicleModule } from '../modules/vehicle'
import type { VehicleHandle } from '../modules/vehicle'
import { physicsStepModule } from '../modules/physics-step'
import { shipVisualModule } from '../modules/ship-visual'
import type { ShipVisualHandle } from '../modules/ship-visual'
import { sunModule } from '../modules/sun'
import type { SunHandle } from '../modules/sun'
import { publishModule } from '../modules/publish'
import type { PublishHandle } from '../modules/publish'
import { attachBridge } from '../bridge'


const SEED = 7

function resolveSeed (defaultSeed = SEED): number {
  if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
    const override = Number(new URLSearchParams(window.location.search).get('seed'))
    if (Number.isFinite(override) && override !== 0)
      return override
  }
  return defaultSeed
}

const _shipPosition   = new THREE.Vector3()
const _shipQuaternion = new THREE.Quaternion()

type AppContext<TState extends object> = Parameters<AppModule<TState>['build']>[0]

export type BaseSceneConfig<TState extends object> = {
  canvas:                   HTMLCanvasElement;
  initialState:             TState;
  seed?:                    number;
  levelId?:                 string;
  levelSpec?:               unknown;
  background?:              THREE.ColorRepresentation;
  bloom?:                   { threshold: number; strength: number; radius: number };
  colliders?:               readonly BoxCollider[];
  colliderOffset?:          readonly [number, number, number];
  useDefaultVehicleModule?: boolean;
  buildGeometry?:           (ctx: AppContext<TState>, physics: Physics) => void;
  gameModuleFactory?: (
    physics: Physics,
    isVehicleCollider: (handle: number) => boolean,
    telemetry: Telemetry,
    controls: Controls,
    vehicleRef: { current: VehicleHandle | null },
    rig: CameraRig
  ) => { module: AppModule<TState>; handleCollision?: (a: number, b: number, started: boolean) => void };
  hudModuleFactory?: (
    shipRoot: THREE.Group,
    telemetry: Telemetry,
    hudRef: { current: HudHandle | null }
  ) => AppModule<TState>;
  extraModules?: Array<AppModule<TState>>;
  onFrame?:        (
    frame: FrameContext,
    shipPosition: THREE.Vector3,
    shipQuaternion: THREE.Quaternion,
    rig: CameraRig,
    controls: Controls
  ) => void;
  onDispose?: () => void;
}

export async function mountBaseScene<TState extends object> (
  config: BaseSceneConfig<TState>
): Promise<App<TState>> {
  const {
    canvas,
    initialState,
    background = '#0a0c14',
    bloom = { threshold: 0.8, strength: 0.4, radius: 0.4 },
    colliders,
    colliderOffset,
    useDefaultVehicleModule = true,
    buildGeometry,
    gameModuleFactory,
    hudModuleFactory,
    extraModules = [],
    onFrame,
    onDispose,
  } = config

  const RAPIER    = await initRapier()
  const physics   = createPhysics(RAPIER)
  const clock     = createSimClock()
  const telemetry = createTelemetry()
  const controls  = createControls()

  type VehicleType = { current: VehicleHandle | null }

  const vehicle: VehicleType = { current: null }

  type SunType = { current: SunHandle | null }

  const sun: SunType = { current: null }

  type HudType = { current: HudHandle | null }

  const hud: HudType = { current: null }

  type ShipVisualType = { current: ShipVisualHandle | null }

  const shipVisual: ShipVisualType = { current: null }

  type PublishType = { current: PublishHandle | null }

  const publish: PublishType = { current: null }

  let composer: { render(delta: number): void } | null = null

  const seed = resolveSeed(config.seed ?? SEED)
  const rng  = createSeededRng(seed)
  const rig  = createCameraRig(rng)

  let skipRender                                                          = false
  let devFrame: ((position: THREE.Vector3, delta: number) => void) | null = null
  let lastViewSeq                                                         = controls.viewSeq

  useCameraView.getState().setView(rig.view())

  const shipRoot = new THREE.Group()

  const isVehicleCollider = (handle: number) => {
    const body = vehicle.current?.body
    if (!body)
      return false
    for (let i = 0; i < body.numColliders(); i++)
      if (body.collider(i).handle === handle)
        return true
    return false
  }

  const game = gameModuleFactory?.(physics, isVehicleCollider, telemetry, controls, vehicle, rig)

  const modules: Array<AppModule<TState>> = [
    standardLighting<TState>({
      env:  { intensity: 0.22 },
      sun:  { intensity: 0 },
      hemi: { skyColor: '#8a9bff', groundColor: '#0a0c14', intensity: 0.2 },
    }),

    sunModule(sun, { intensity: 1.6, frustum: 45, mapSize: 2048 }) as unknown as AppModule<TState>,

    defineModule<TState>({
      name: 'scene-geometry',
      build (ctx) {
        buildGeometry?.(ctx, physics)
        if (colliders)
          attachBoxColliders(physics, colliders, colliderOffset)
      },
    }),

    shipVisualModule(shipRoot, telemetry, shipVisual) as unknown as AppModule<TState>,
  ]

  if (hudModuleFactory)
    modules.push(hudModuleFactory(shipRoot, telemetry, hud))

  modules.push(
    defineModule<TState>({
      name: 'input-sync',
      build () {},
      update () {
        app.setState({
          steer:    controls.steer,
          throttle: controls.throttle,
          brake:    controls.brake,
          boost:    controls.boost,
          reverse:  controls.reverse,
          strafe:   controls.strafe,
          resetSeq: controls.resetSeq,
        } as unknown as Partial<TState>)
      },
    })
  )

  if (game?.module)
    modules.push(game.module)

  if (useDefaultVehicleModule)
    modules.push(
      vehicleModule(physics, telemetry, vehicle, () => rig.requestSnap()) as unknown as AppModule<TState>
    )

  modules.push(
    physicsStepModule(physics, game?.handleCollision) as unknown as AppModule<TState>,
    publishModule(telemetry, publish) as unknown as AppModule<TState>,

    defineModule<TState>({
      name: 'impact',
      build () {},
      update () {
        if (telemetry.shake > 0) {
          rig.shake(telemetry.shake)
          telemetry.shake = 0
        }
      },
    }),

    ...extraModules,

    postProcessing<TState>({
      bloom,
      effects: ctx => {
        composer = ctx.composer
        return []
      },
    })
  )

  const app = createApp<TState>(canvas, {
    state:    initialState,
    seed,
    clock,
    camera:   rig.camera,
    scene:    { background },
    renderer: { shadows: true },
    use:      modules,

    render (frame) {
      if (skipRender)
        return
      renderFrame(frame)
    },
  })

  function renderFrame (frame: FrameContext) {
    if (controls.viewSeq !== lastViewSeq) {
      lastViewSeq = controls.viewSeq
      rig.toggleView()
      useCameraView.getState().setView(rig.view())
    }

    const interpolator = vehicle.current?.interpolator
    if (interpolator) {
      interpolator.sample(clock.alpha(), _shipPosition, _shipQuaternion)
      shipRoot.position.copy(_shipPosition)
      shipRoot.quaternion.copy(_shipQuaternion)
      rig.drive(frame.delta, _shipPosition, _shipQuaternion, controls)
      sun.current?.follow(_shipPosition)

      const blend = rig.blend()
      shipVisual.current?.setHullVisible(blend < 0.85)

      const throttle = controls.throttle ? controls.boost ? 1 : 0.72 : 0
      hud.current?.update(
        frame.elapsed,
        _shipPosition,
        _shipQuaternion,
        throttle,
        blend,
        rig.camera,
        controls.panX,
        controls.panY
      )

      onFrame?.(frame, _shipPosition, _shipQuaternion, rig, controls)
      devFrame?.(_shipPosition, frame.delta)
    }
    else
      onFrame?.(frame, _shipPosition, _shipQuaternion, rig, controls)

    if (composer)
      composer.render(frame.delta)
    else
      app.ctx.renderer.render(app.ctx.scene, rig.camera)
  }

  const detachControls = attachControls(canvas, controls)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detachBridge   = attachBridge(app as any)

  let detachDev: (() => void) | null = null
  if (process.env.NODE_ENV !== 'production') {
    const { attachDevHarness } = await import('../dev/harness')
    const harness              = attachDevHarness({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      app:           app as any,
      physics,
      clock,
      controls,
      telemetry,
      vehicle,
      sun,
      publish,
      rig,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      level:         config.levelSpec as any,
      seed,
      levelId:       config.levelId ?? 'battle',
      setSkipRender: skip => {
        skipRender = skip
      },
      renderOnce: partial => renderFrame({
        delta:   partial?.delta ?? 1 / 60,
        elapsed: partial?.elapsed ?? clock.elapsed(),
        frame:   partial?.frame ?? 0,
      }),
    })
    devFrame  = harness.onFrame
    detachDev = harness.detach
  }

  const dispose = app.dispose
  app.dispose   = () => {
    onDispose?.()
    detachDev?.()
    detachControls()
    detachBridge()
    composer = null
    dispose()
    physics.free()
  }

  return app
}
