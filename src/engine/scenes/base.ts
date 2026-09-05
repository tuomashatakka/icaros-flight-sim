import * as THREE from 'three'
import { createApp, createSeededRng, defineModule } from 'threejs-scene'
import type { App, AppModule, FrameContext } from 'threejs-scene'
import { postProcessing } from 'threejs-scene/modules/post'
import type { PostProcessingOptions } from 'threejs-scene/modules/post'
import { useCameraView } from '@/hooks/use-camera-view'
import { initRapier } from '@crash-velocity/physics/rapier'
import { createSimClock } from '@crash-velocity/physics/clock'
import { createPhysics } from '@crash-velocity/physics/world'
import type { Physics } from '@crash-velocity/physics/world'
import { attachBoxColliders } from '@crash-velocity/physics/colliders'
import type { BoxCollider } from '@crash-velocity/physics/colliders'
import { createTelemetry } from '../telemetry'
import type { Telemetry } from '../telemetry'
import { createControls, attachControls } from '../input'
import type { Controls } from '../input'
import { createCameraRig } from '../camera/rig'
import type { CameraRig } from '../camera/rig'
import type { HudHandle, HudViewFrame } from '../hud'
import type { VehicleHandle } from '../vehicle'
import { physicsStepModule } from '../modules/physics-step'
import { shipVisualModule } from '../modules/ship-visual'
import type { ShipVisualHandle } from '../modules/ship-visual'
import type { SunHandle } from '../modules/sun'
import { environmentModules, resolveEnvironment } from './environment'
import type { EnvironmentOverrides } from './environment'
import { publishModule } from '../modules/publish'
import type { PublishHandle } from '../modules/publish'
import { attachBridge } from '../bridge'
import { createRendererQuality } from '../quality/runtime'


const SEED = 7

function resolveSeed (defaultSeed = SEED): number {
  if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
    const override = Number(new URLSearchParams(window.location.search).get('seed'))
    if (Number.isFinite(override) && override !== 0)
      return override
  }
  return defaultSeed
}

// Reused so the render phase stays allocation-free; the rig only reads it.
const _pan            = { panX: 0, panY: 0, pitch: 0 }
const _shipPosition   = new THREE.Vector3()
const _shipQuaternion = new THREE.Quaternion()
const _hudQuaternion  = new THREE.Quaternion()
const _hudLead        = new THREE.Quaternion()

/** The HUD's per-frame record, mutated in place so the render phase allocates nothing. */
const _view: HudViewFrame = {
  elapsed:        0,
  shipPosition:   _shipPosition,
  hullQuaternion: _shipQuaternion,
  throttle:       0,
  cameraBlend:    0,
  camera:         null as unknown as THREE.Camera,
  hudQuaternion:  _hudQuaternion,
  hudLead:        _hudLead,
  panX:           0,
  panY:           0,
  aimPitch:       0,
}

/**
 * Visual nose swing from the R/F aim axis, radians (~18 deg).
 *
 * Bounded low on purpose: the hull is still visibly hovering flat above the
 * track, so past this the nose reads as detached from the vehicle rather than
 * aimed. Nothing here reaches the physics — the surface-alignment `setAngvel`
 * in `vehicle.ts` owns the ship's actual attitude and never sees this value.
 */
const MAX_AIM_PITCH = 0.31

type AppContext<TState extends object> = Parameters<AppModule<TState>['build']>[0]

/** The slice of the post module a scene is allowed to fill in. */
export type ScenePost = Pick<PostProcessingOptions, 'depth' | 'effects' | 'onFrame' | 'onResize'>

export type BaseSceneConfig<TState extends object> = {
  canvas:       HTMLCanvasElement;
  initialState: TState;
  seed?:        number;
  levelId?:     string;
  levelSpec?:   unknown;

  /**
   * How this scene differs from `DEFAULT_ENVIRONMENT`.
   *
   * Sky, fog, fill and the key light are one budget — a scene states its deltas
   * here rather than adding lights of its own, so the key-to-fill ratio that
   * makes the ship's shadow readable survives every level. It replaces the old
   * `background` outright: a bare clear colour with no fog to match it is what
   * made every level state the same two values twice.
   */
  environment?:    EnvironmentOverrides;
  bloom?:          { threshold: number; strength: number; radius: number };
  colliders?:      readonly BoxCollider[];
  colliderOffset?: readonly [number, number, number];

  /**
   * Normalised vertical aim, -1..1, if the scene owns it.
   *
   * Race leaves this unset and gets the spring: `controls.pitch` falls to 0 on
   * release and the nose returns to level. Battle integrates a trim inside the
   * sim and reports it here, so the hull and camera keep showing the elevation
   * the guns are actually holding.
   */
  aimPitchSource?: () => number;

  /**
   * Extra post passes and their per-frame uniform hooks.
   *
   * `bloom` stays a separate field because it is the composer's own, built
   * before anything here. Everything in this slot lands between the bloom and
   * the OutputPass, which is what keeps the grade in linear HDR.
   */
  post?: ScenePost;

  /**
   * Filled at build time with the hull's handle, if the scene needs it.
   *
   * The base owns the ship visual, but battle's reticle has to ask the DRAWN
   * guns where their muzzles are. Handing the ref in beats widening
   * `gameModuleFactory`, which already takes six arguments.
   */
  shipVisualRef?: { current: ShipVisualHandle | null };

  /** Camera far plane. Defaults to the race rig's 400. */
  cameraFar?:         number;
  buildGeometry?:     (ctx: AppContext<TState>, physics: Physics) => void;
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
    hudRef: { current: HudHandle | null },
    controls: Controls
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
  onQuality?: (effects: 0 | 1 | 2) => void;
}

export async function mountBaseScene<TState extends object> (
  config: BaseSceneConfig<TState>
): Promise<App<TState>> {
  const {
    canvas,
    initialState,
    bloom = { threshold: 0.8, strength: 0.4, radius: 0.4 },
    colliders,
    colliderOffset,
    aimPitchSource,
    post,
    buildGeometry,
    gameModuleFactory,
    hudModuleFactory,
    extraModules = [],
    onFrame,
    onDispose,
  } = config

  const environment = resolveEnvironment(config.environment)

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

  const shipVisual: ShipVisualType = config.shipVisualRef ?? { current: null }

  type PublishType = { current: PublishHandle | null }

  const publish: PublishType = { current: null }

  let composer: { render(delta: number): void } | null = null

  const seed = resolveSeed(config.seed ?? SEED)
  const rng  = createSeededRng(seed)
  const rig  = createCameraRig(rng, config.cameraFar)

  let skipRender                                                          = false
  let devFrame: ((position: THREE.Vector3, delta: number) => void) | null = null
  let hullAimPitch                                                        = 0
  let lastViewSeq                                                         = controls.viewSeq
  let lastViewBlendSeq                                                    = controls.viewBlendSeq
  let lastView                                                            = rig.view()

  useCameraView.getState().setView(lastView)

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
    ...environmentModules<TState>(environment, sun),

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
    modules.push(hudModuleFactory(shipRoot, telemetry, hud, controls))

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
      depth:    post?.depth,
      onFrame:  post?.onFrame,
      onResize: post?.onResize,
      effects:  ctx => {
        // The composer is captured here rather than in `build` because this is
        // the only callback the module hands it out from, and `renderFrame`
        // needs it to draw at all.
        composer = ctx.composer
        return post?.effects?.(ctx) ?? []
      },
    })
  )

  const app = createApp<TState>(canvas, {
    state:    initialState,
    seed,
    clock,
    camera:   rig.camera,
    scene:    { background: environment.background },
    renderer: { shadows: true },
    use:      modules,

    render (frame) {
      if (skipRender)
        return
      renderFrame(frame)
    },
  })

  const quality = createRendererQuality({
    renderer:  app.ctx.renderer,
    scene:     app.ctx.scene,
    sun,
    onEffects: config.onQuality,
  })

  let lastHudAt = -Infinity

  function renderFrame (frame: FrameContext) {
    quality.beginFrame()
    if (controls.viewSeq !== lastViewSeq) {
      lastViewSeq = controls.viewSeq
      rig.toggleView()
    }

    if (controls.viewBlendSeq !== lastViewBlendSeq) {
      lastViewBlendSeq = controls.viewBlendSeq
      rig.setBlend(controls.viewBlend, true)
    }

    // `useCameraView` is a mirror for DOM chrome, not the source of truth, and a
    // pinch moves the blend every frame. Write it only when the discrete view
    // actually flips or React commits at thumb rate.
    const view = rig.view()
    if (view !== lastView) {
      lastView = view
      useCameraView.getState().setView(view)
    }

    const interpolator = vehicle.current?.interpolator
    if (interpolator) {
      // Race passes nothing and gets the spring off the raw held axis; battle
      // reports its integrated trim. Either way the hull is eased rather than
      // snapped, because the sim's trim steps at 60 Hz and the render does not.
      const aimNorm = aimPitchSource ? aimPitchSource() : controls.pitch
      hullAimPitch += (aimNorm * MAX_AIM_PITCH - hullAimPitch) *
        (1 - Math.exp(-9 * frame.delta))
      shipVisual.current?.setAimPitch(hullAimPitch)

      interpolator.sample(clock.alpha(), _shipPosition, _shipQuaternion)
      shipRoot.position.copy(_shipPosition)
      shipRoot.quaternion.copy(_shipQuaternion)
      _pan.panX  = controls.panX
      _pan.panY  = controls.panY
      _pan.pitch = aimNorm
      rig.drive(frame.delta, _shipPosition, _shipQuaternion, _pan)
      rig.hudQuaternion(_hudQuaternion)
      rig.hudLead(_hudLead)
      sun.current?.follow(_shipPosition)

      const blend = rig.blend()
      shipVisual.current?.setHullVisible(blend < 0.85)

      _view.elapsed     = frame.elapsed
      _view.throttle    = telemetry.thrustCommand
      _view.cameraBlend = blend
      _view.camera      = rig.camera
      _view.panX        = controls.panX
      _view.panY        = controls.panY
      _view.aimPitch    = aimNorm
      if (frame.elapsed - lastHudAt >= 1 / quality.settings().hudHz) {
        hud.current?.update(_view)
        lastHudAt = frame.elapsed
      }

      onFrame?.(frame, _shipPosition, _shipQuaternion, rig, controls)
      devFrame?.(_shipPosition, frame.delta)
    }
    else
      onFrame?.(frame, _shipPosition, _shipQuaternion, rig, controls)

    if (composer)
      composer.render(frame.delta)
    else
      app.ctx.renderer.render(app.ctx.scene, rig.camera)
    quality.endFrame(frame.delta * 1000)
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
      quality,
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
    quality.dispose()
    composer = null
    dispose()
    physics.free()
  }

  return app
}
