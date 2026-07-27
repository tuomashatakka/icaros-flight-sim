import * as THREE from 'three';
import { createApp, defineModule, type App } from 'threejs-scene';
import { standardLighting } from 'threejs-scene/modules/lighting';
import { orbitControls } from 'threejs-scene/modules/orbit';
import { postProcessing } from 'threejs-scene/modules/post';
import { useShipStore } from '@/hooks/use-ship-store';
import { useHangarView } from '@/hooks/use-hangar-view';
import type { ShipConfig } from '@/lib/ship/registry';
import { loadShip, type ShipInstance } from '../assets/ship-loader';

/** Turntable speed in rad/SECOND. The R3F version spun per FRAME, so it ran at
 * whatever the display did — 0.005/frame at 60 Hz is what this reproduces. */
const TURNTABLE_RATE = 0.3;

const SHIP_TARGET_SIZE = 4.8;

/** Matches the R3F build: the model group sat at y = -1.5 above a floor at -3.5. */
const SHIP_LIFT = -1.5;
const FLOOR_Y = -3.5;

type HangarState = {
  shipConfig: ShipConfig | null;
  spinning: boolean;
  wireframe: boolean;
  flightTilt: boolean;
  engines: boolean;
};

/** Peak bank/pitch of the idle "flight tilt" animation, in radians. */
const TILT_BANK = 0.14;
const TILT_PITCH = 0.06;

export type HangarStatus = 'loading' | 'ready' | 'error';

/** Floor, fog and the fill lights — everything that isn't the ship. */
function hangarSet() {
  return defineModule<HangarState>({
    name: 'hangar-set',

    build(ctx) {
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
        new THREE.MeshStandardMaterial({ color: '#1a1a2e', metalness: 0.3, roughness: 0.7 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = FLOOR_Y;
      floor.receiveShadow = true;
      ctx.scene.add(floor);

      // Light rig copied 1:1 from the R3F hangar — including the very low point
      // light intensities, which are physically-correct values with decay 2, not
      // the tens-to-hundreds used out on the tracks.
      ctx.scene.add(new THREE.HemisphereLight('#ff69b4', '#4a90e2', 0.8));

      const key = new THREE.DirectionalLight('#ffffff', 1.5);
      key.position.set(10, 10, 5);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.camera.left = -8;
      key.shadow.camera.right = 8;
      key.shadow.camera.top = 8;
      key.shadow.camera.bottom = -8;
      key.shadow.camera.near = 0.5;
      key.shadow.camera.far = 40;
      key.shadow.normalBias = 0.02;
      key.shadow.camera.updateProjectionMatrix();
      ctx.scene.add(key);

      const magenta = new THREE.PointLight('#ff00ff', 0.5);
      magenta.position.set(-10, 5, -5);
      ctx.scene.add(magenta);

      const cyan = new THREE.PointLight('#00ffff', 0.3);
      cyan.position.set(0, -10, 0);
      ctx.scene.add(cyan);

      ctx.scene.fog = new THREE.Fog('#171720', 20, 100);
    },
  });
}

/** The ship on its turntable, plus livery updates and hot-swapping. */
function shipDisplay(onStatus: (status: HangarStatus) => void) {
  let instance: ShipInstance | null = null;
  let lastConfig: ShipConfig | null = null;
  let lastWireframe: boolean | null = null;
  let generation = 0;

  // Two nested groups on purpose: the turntable owns yaw, the cradle owns the
  // idle tilt. One group doing both would have the tilt fighting the spin for
  // the same Euler, and the bank would swing with the turntable angle.
  const pivot = new THREE.Group();
  pivot.position.y = SHIP_LIFT;
  const cradle = new THREE.Group();
  pivot.add(cradle);

  function applyWireframe(on: boolean) {
    if (!instance) return;
    instance.root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        // The afterburner quads are MeshBasicMaterial and look like garbage as
        // wireframe, so the overlay is limited to the hull's surface materials.
        if (material && 'wireframe' in material && !material.transparent) {
          (material as THREE.MeshStandardMaterial).wireframe = on;
        }
      }
    });
  }

  async function swapTo(config: ShipConfig, scene: THREE.Scene) {
    const mine = ++generation;
    onStatus('loading');
    try {
      const next = await loadShip(config.shipId, SHIP_TARGET_SIZE);
      // A slow load for ship A must not land after the user has picked B.
      if (mine !== generation) {
        next.dispose();
        return;
      }
      instance?.dispose();
      instance = next;
      next.applyConfig(config);
      cradle.add(next.root);
      if (!pivot.parent) scene.add(pivot);
      lastWireframe = null; // force a re-apply onto the new materials
      onStatus('ready');
    } catch (cause) {
      console.error('[hangar] ship load failed', cause);
      if (mine === generation) onStatus('error');
    }
  }

  return defineModule<HangarState>({
    name: 'ship-display',

    build(ctx) {
      ctx.scene.add(pivot);
    },

    update(state, frame, ctx) {
      const config = state.shipConfig;
      if (config && config !== lastConfig) {
        const shipChanged = lastConfig?.shipId !== config.shipId;
        lastConfig = config;
        if (shipChanged) void swapTo(config, ctx.scene as THREE.Scene);
        else instance?.applyConfig(config);
      }

      if (state.wireframe !== lastWireframe) {
        lastWireframe = state.wireframe;
        applyWireframe(state.wireframe);
      }

      // Per second, not per frame — the R3F version was framerate-dependent.
      if (state.spinning) pivot.rotation.y += TURNTABLE_RATE * frame.delta;

      // Idle tilt: two incommensurate periods so the loop never visibly repeats.
      if (state.flightTilt) {
        cradle.rotation.z = Math.sin(frame.elapsed * 0.7) * TILT_BANK;
        cradle.rotation.x = Math.sin(frame.elapsed * 0.43) * TILT_PITCH;
      } else {
        cradle.rotation.set(0, 0, 0);
      }

      if (instance) {
        instance.burner.setThrottle(state.engines ? 1 : 0);
        instance.burner.update(frame.delta, frame.elapsed);
      }
    },

    dispose() {
      generation++;
      instance?.dispose();
      instance = null;
      lastConfig = null;
      lastWireframe = null;
      pivot.removeFromParent();
    },
  });
}

/**
 * The hangar scene.
 *
 * Ship changes are `setState`, never a remount: rebuilding the app for a model
 * swap would drop the WebGL context and re-PMREM the environment for nothing.
 */
export function mountHangar(
  canvas: HTMLCanvasElement,
  onStatus: (status: HangarStatus) => void = () => {}
): App<HangarState> {
  const app = createApp<HangarState>(canvas, {
    state: {
      shipConfig: useShipStore.getState().currentConfig,
      spinning: useHangarView.getState().autoOrbit,
      wireframe: useHangarView.getState().wireframe,
      flightTilt: useHangarView.getState().flightTilt,
      engines: useHangarView.getState().engines,
    },
    seed: 11,
    camera: { position: [0, 5, 15], lookAt: [0, 0, 0], fov: 45 },
    scene: { background: '#171720' },
    renderer: { shadows: true },
    use: [
      // The env map is what makes the hulls' envMapIntensity and clearcoat do
      // anything at all — without it they are silent no-ops and every ship
      // reads flat. This replaces drei's <Environment preset="night" />, which
      // fetched an HDRI from a CDN; this one is a procedural PMREM room, so the
      // mood is a touch more neutral but nothing is a no-op.
      standardLighting<HangarState>({
        env: { intensity: 0.4 },
        sun: { intensity: 0 },
        hemi: { intensity: 0 },
      }),
      hangarSet(),
      shipDisplay(onStatus),
      orbitControls<HangarState>({ radius: [3, 15], target: [0, 0, 0] }),
      postProcessing<HangarState>({
        // Slightly under the original 0.95 so the afterburner blooms, but not so
        // low that the hull's own speculars join in — the plume is additive and
        // `toneMapped: false`, so it clears any sane threshold on its own.
        bloom: { strength: 0.45, threshold: 0.9, radius: 0.6 },
      }),
    ],
  });

  // Livery edits and ship picks arrive from the DOM panel through zustand.
  const unsubscribeShip = useShipStore.subscribe(
    (s) => s.currentConfig,
    (shipConfig) => app.setState({ shipConfig })
  );

  const unsubscribeView = useHangarView.subscribe((view) =>
    app.setState({
      spinning: view.autoOrbit,
      wireframe: view.wireframe,
      flightTilt: view.flightTilt,
      engines: view.engines,
    })
  );

  if (process.env.NODE_ENV !== 'production') {
    (window as unknown as Record<string, unknown>).__hangar = app;
  }

  const dispose = app.dispose;
  app.dispose = () => {
    unsubscribeShip();
    unsubscribeView();
    dispose();
  };

  return app;
}
