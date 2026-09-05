import * as THREE from 'three'
import { createApp, defineModule } from 'threejs-scene'
import type { App } from 'threejs-scene'
import { orbitControls } from 'threejs-scene/modules/orbit'
import { postProcessing } from 'threejs-scene/modules/post'
import { hangarViewStore, shipStore } from 'Δstate'
import type { ShipConfig } from '@/lib/ship/registry'
import { loadShip } from '../assets/ship-loader'
import type { ShipInstance } from '../assets/ship-loader'
import type { SunHandle } from '../modules/sun'


type SunRef = { current: SunHandle | null }

import { environmentModules, resolveEnvironment } from './environment'

// Turntable speed in rad/SECOND. The R3F version spun per FRAME, so it ran at
// whatever the display did — 0.005/frame at 60 Hz is what this reproduces.
const TURNTABLE_RATE = 0.3

const SHIP_TARGET_SIZE = 4.8

/** Matches the R3F build: the model group sat at y = -1.5 above a floor at -3.5. */
const SHIP_LIFT = -1.5
const FLOOR_Y   = -3.5

/**
 * The showroom, as deltas from the shared environment.
 *
 * A turntable is not a track: the key light stays put (nothing calls the sun
 * handle's `follow`), the shadow box only has to cover one hull, and the fill is
 * the magenta/cyan showroom wash the R3F build had rather than a daylight sky.
 */
const HANGAR_ENVIRONMENT = resolveEnvironment({
  background:   '#171720',
  fog:          [ '#171720', 20, 100 ],
  hemi:         { sky: '#ff69b4', ground: '#4a90e2', intensity: 0.8 },
  envIntensity: 0.4,
  sun:          { offset: [ 10, 10, 5 ], intensity: 2.2, frustum: 8 },
})

type HangarState = {
  shipConfig: ShipConfig | null;
  spinning:   boolean;
  wireframe:  boolean;
  flightTilt: boolean;
  engines:    boolean;
}

/** Peak bank/pitch of the idle "flight tilt" animation, in radians. */
const TILT_BANK  = 0.14
const TILT_PITCH = 0.06

export type HangarStatus = 'loading' | 'ready' | 'error'

/** Floor, fog and the fill lights — everything that isn't the ship. */
function hangarSet () {
  return defineModule<HangarState>({
    name: 'hangar-set',

    build (ctx) {
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        new THREE.MeshStandardMaterial({ color: '#1a1a2e', metalness: 0.3, roughness: 0.7 })
      )
      floor.rotation.x    = -Math.PI / 2
      floor.position.y    = FLOOR_Y
      floor.receiveShadow = true
      ctx.scene.add(floor)

      // Sky, fog and the key light come from `HANGAR_ENVIRONMENT` like every
      // other scene's. These two are accents: physically-correct intensities
      // with decay 2, not the tens-to-hundreds used out on the tracks.
      const magenta = new THREE.PointLight('#ff00ff', 0.5)
      magenta.position.set(-10, 5, -5)
      ctx.scene.add(magenta)

      const cyan = new THREE.PointLight('#00ffff', 0.3)
      cyan.position.set(0, -10, 0)
      ctx.scene.add(cyan)
    },
  })
}

/** The ship on its turntable, plus livery updates and hot-swapping. */
function shipDisplay (onStatus: (status: HangarStatus) => void) {
  let instance: ShipInstance | null        = null
  let lastConfig: ShipConfig | null        = null
  let generation                           = 0
  let wireOverlayGroup: THREE.Group | null = null

  // Single shared wireframe overlay material — pre-compiled once so toggling
  // wireframe mode never sets `material.needsUpdate = true` on solid materials
  // and never causes WebGL shader recompilation flashing.
  const wireMat = new THREE.MeshBasicMaterial({
    color:       '#22d3ee',
    wireframe:   true,
    transparent: true,
    opacity:     0.5,
  })

  // Two nested groups on purpose: the turntable owns yaw, the cradle owns the
  // idle tilt. One group doing both would have the tilt fighting the spin for
  // the same Euler, and the bank would swing with the turntable angle.
  const pivot      = new THREE.Group()
  pivot.position.y = SHIP_LIFT

  const cradle     = new THREE.Group()
  pivot.add(cradle)

  function buildWireframeOverlay (root: THREE.Group): THREE.Group {
    // Deep clone the full root hierarchy so scale/fit/rotation transforms match 1:1
    const group = root.clone(true)
    group.name  = 'wireframe-overlay'

    group.traverse(child => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh         = child as THREE.Mesh
        mesh.material      = wireMat
        mesh.castShadow    = false
        mesh.receiveShadow = false
      }
    })
    return group
  }

  async function swapTo (config: ShipConfig, scene: THREE.Scene, initialWireframe: boolean) {
    const mine = ++generation
    onStatus('loading')
    try {
      const next = await loadShip(config.shipId, SHIP_TARGET_SIZE)
      // A slow load for ship A must not land after the user has picked B.
      if (mine !== generation) {
        next.dispose()
        return
      }
      next.applyConfig(config)

      // Add a dedicated wireframe overlay group to the new ship instance
      if (wireOverlayGroup)
        wireOverlayGroup.removeFromParent()
      wireOverlayGroup = buildWireframeOverlay(next.root)
      wireOverlayGroup.visible = initialWireframe
      next.root.add(wireOverlayGroup)

      cradle.add(next.root)
      if (!pivot.parent)
        scene.add(pivot)

      // Swap out the old instance AFTER the new one is added to avoid a blank frame
      const prev = instance
      instance = next
      prev?.dispose()

      onStatus('ready')
    }
    catch (cause) {
      console.error('[hangar] ship load failed', cause)
      if (mine === generation)
        onStatus('error')
    }
  }

  return defineModule<HangarState>({
    name: 'ship-display',

    build (ctx) {
      ctx.scene.add(pivot)
    },

    update (state, frame, ctx) {
      const config = state.shipConfig
      if (config && config !== lastConfig) {
        const shipChanged = lastConfig?.shipId !== config.shipId
        lastConfig = config
        if (shipChanged)
          void swapTo(config, ctx.scene as THREE.Scene, state.wireframe)
        else
          instance?.applyConfig(config)
      }

      if (wireOverlayGroup)
        wireOverlayGroup.visible = state.wireframe

      // Per second, not per frame — the R3F version was framerate-dependent.
      if (state.spinning)
        pivot.rotation.y += TURNTABLE_RATE * frame.delta

      // Idle tilt: two incommensurate periods so the loop never visibly repeats.
      if (state.flightTilt) {
        cradle.rotation.z = Math.sin(frame.elapsed * 0.7) * TILT_BANK
        cradle.rotation.x = Math.sin(frame.elapsed * 0.43) * TILT_PITCH
      }
      else
        cradle.rotation.set(0, 0, 0)

      if (instance) {
        instance.burner.setThrottle(state.engines ? 1 : 0)
        instance.burner.update(frame.delta, frame.elapsed)
      }
    },

    dispose () {
      generation++
      instance?.dispose()
      instance = null
      lastConfig = null
      wireOverlayGroup?.removeFromParent()
      wireOverlayGroup = null
      wireMat.dispose()
      pivot.removeFromParent()
    },
  })
}

/**
 * The hangar scene.
 *
 * Ship changes are `setState`, never a remount: rebuilding the app for a model
 * swap would drop the WebGL context and re-PMREM the environment for nothing.
 */
export function mountHangar (
  canvas: HTMLCanvasElement,
  onStatus: (status: HangarStatus) => void = () => {}
): App<HangarState> {
  const sun: SunRef = { current: null }

  const app = createApp<HangarState>(canvas, {
    state: {
      shipConfig: shipStore.get().currentConfig,
      spinning:   hangarViewStore.get().autoOrbit,
      wireframe:  hangarViewStore.get().wireframe,
      flightTilt: hangarViewStore.get().flightTilt,
      engines:    hangarViewStore.get().engines,
    },
    seed:     11,
    camera:   { position: [ 0, 5, 15 ], lookAt: [ 0, 0, 0 ], fov: 45 },
    scene:    { background: HANGAR_ENVIRONMENT.background },
    renderer: { shadows: true },
    use:      [
      // The same environment rig the tracks and the arena mount. Its PMREM env
      // map is what makes the hulls' envMapIntensity and clearcoat do anything
      // at all — without it they are silent no-ops and every ship reads flat.
      ...environmentModules<HangarState>(HANGAR_ENVIRONMENT, sun),
      hangarSet(),
      shipDisplay(onStatus),
      orbitControls<HangarState>({ radius: [ 3, 15 ], target: [ 0, 0, 0 ]}),
      postProcessing<HangarState>({
        // Slightly under the original 0.95 so the afterburner blooms, but not so
        // low that the hull's own speculars join in — the plume is additive and
        // `toneMapped: false`, so it clears any sane threshold on its own.
        bloom: { strength: 0.45, threshold: 0.9, radius: 0.6 },
      }),
    ],
  })

  // Livery edits and ship picks arrive from the DOM panel through zustand.
  const unsubscribeShip = shipStore.select(
    s => s.currentConfig,
    shipConfig => app.setState({ shipConfig })
  )

  const unsubscribeView = hangarViewStore.subscribe(view =>
    app.setState({
      spinning:   view.autoOrbit,
      wireframe:  view.wireframe,
      flightTilt: view.flightTilt,
      engines:    view.engines,
    })
  )

  if (process.env.NODE_ENV !== 'production')
    (window as unknown as Record<string, unknown>).__hangar = app

  const dispose = app.dispose
  app.dispose   = () => {
    unsubscribeShip()
    unsubscribeView()
    dispose()
  }

  return app
}
