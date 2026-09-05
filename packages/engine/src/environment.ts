import * as THREE from 'three'
import { defineModule } from 'threejs-scene'
import type { AppModule } from 'threejs-scene'
import { standardLighting } from 'threejs-scene/modules/lighting'
import { sunModule } from './modules/sun'
import type { SunHandle } from './modules/sun'


/**
 * The one environment every scene extends.
 *
 * Levels used to own their whole light rig, and each of them stacked a
 * `HemisphereLight` at 0.7-0.95 plus two to four point lights on top of the
 * base scene's env and hemi fill. The single shadow-casting key light was then
 * lighting a scene that was already fully lit, so the ship's shadow was a faint
 * smudge on every track. Fill and key belong to one budget or neither can be
 * reasoned about, so they live here and a level only says how it differs.
 */
export type EnvironmentSpec = {
  background: string;

  /** `[color, near, far]`. Applied as linear `THREE.Fog`. */
  fog: [string, number, number];

  /** Ambient sky/ground fill. Its colours are the level's identity; its intensity is not. */
  hemi: { sky: string; ground: string; intensity: number };

  /** PMREM room-environment IBL. Without it `envMapIntensity` and clearcoat are no-ops. */
  envIntensity: number;

  sun: {

    /** Direction from the ship to the light. */
    offset:    [number, number, number];
    color:     string;
    intensity: number;

    /** Half-extent of the ortho shadow box, in world units. */
    frustum: number;
    mapSize: number;
  };
}

/**
 * Key-to-fill ratio is the whole point of these numbers.
 *
 * `sun.intensity` sits well above the combined `envIntensity + hemi.intensity`
 * so a hull actually occludes something. Raising either fill value back toward
 * what the levels used to carry puts the shadow straight back into the mud.
 */
export const DEFAULT_ENVIRONMENT: EnvironmentSpec = {
  background:   '#0a0c14',
  fog:          [ '#0a0c14', 150, 500 ],
  hemi:         { sky: '#8a9bff', ground: '#0a0c14', intensity: 0.38 },
  envIntensity: 0.22,
  sun:          {
    offset:    [ 40, 60, 25 ],
    color:     '#ffffff',
    intensity: 3.2,
    frustum:   45,
    mapSize:   2048,
  },
}

/**
 * A scene's deltas from the shared base.
 *
 * `Partial<EnvironmentSpec>` alone would still demand every field of `hemi` and
 * `sun`, which defeats the point — a level wants to say "these two colours" or
 * "a wider shadow box" and inherit the rest.
 */
export type EnvironmentOverrides = Partial<Omit<EnvironmentSpec, 'hemi' | 'sun'>> & {
  hemi?: Partial<EnvironmentSpec['hemi']>;
  sun?:  Partial<EnvironmentSpec['sun']>;
}

/** Merge a scene's deltas over the shared base. One level deep per group, by design. */
export function resolveEnvironment (overrides: EnvironmentOverrides = {}): EnvironmentSpec {
  return {
    ...DEFAULT_ENVIRONMENT,
    ...overrides,
    hemi: { ...DEFAULT_ENVIRONMENT.hemi, ...overrides.hemi },
    sun:  { ...DEFAULT_ENVIRONMENT.sun, ...overrides.sun },
  }
}

type SunRef = { current: SunHandle | null }

/**
 * The environment as modules, in mount order.
 *
 * Returned as an array rather than one module because the IBL rig and the
 * shadow-casting key light are separate concerns with separate lifetimes, and
 * `standardLighting` is the package's to own. Spread this at the head of a
 * scene's module array; nothing here has a render hook, so it does not contend
 * with `postProcessing` having to be last.
 */
export function environmentModules<TState extends object> (
  spec: EnvironmentSpec,
  sunRef: SunRef
): Array<AppModule<TState>> {
  return [
    standardLighting<TState>({
      env:  { intensity: spec.envIntensity },
      // The package's own sun is a fixed-position light with a 15-unit shadow
      // frustum. `sunModule` replaces it because a fixed frustum loses the ship.
      sun:  { intensity: 0 },
      hemi: { skyColor: spec.hemi.sky, groundColor: spec.hemi.ground, intensity: spec.hemi.intensity },
    }),

    sunModule(sunRef, spec.sun) as unknown as AppModule<TState>,

    defineModule<TState>({
      name: 'environment',

      build (ctx) {
        // Set explicitly so it is a decision rather than a default. NOT
        // `PCFSoftShadowMap`: three deprecated it in r18x and silently
        // downgrades it to this, with a console warning on the first shadow
        // render. Softness comes from the frustum staying tight around the ship
        // instead — see `sunModule`.
        ctx.renderer.shadowMap.type = THREE.PCFShadowMap
        ctx.scene.fog               = new THREE.Fog(spec.fog[0], spec.fog[1], spec.fog[2])
      },

      dispose () {},
    }),
  ]
}
