import * as THREE from 'three'
import { defineModule } from 'threejs-scene'
import type { AppModule } from 'threejs-scene'
import type { RaceState } from '../state'


const _target = new THREE.Vector3()

export type SunHandle = {

  /** Re-centre the shadow camera on the ship. Called from the render phase. */
  follow(position: THREE.Vector3): void;

  /** The key light itself — the dev overlay draws a helper on its shadow camera. */
  readonly light: THREE.DirectionalLight | null;
}

/**
 * Shadow-casting key light that tracks the ship.
 *
 * A fixed shadow camera does not work here: `standardLighting`'s sun sits at the
 * origin with an ortho frustum of ~100, while the flats deck is +/-200 and the
 * ship reaches the walls at +/-150 — so it drives clean out of the shadow volume
 * and its shadow vanishes. Following the ship also lets the frustum stay small,
 * which is what keeps shadow texels dense enough not to shimmer.
 */
type HandleType = { current: SunHandle | null }

export function sunModule (
  handle: HandleType,
  options: {

    /** Direction from the ship to the light. */
    offset?:    [number, number, number];
    intensity?: number;
    color?:     string;

    /** Half-extent of the ortho shadow box, in world units. */
    frustum?: number;
    mapSize?: number;
  } = {}
): AppModule<RaceState> {
  const offset  = options.offset ?? [ 40, 60, 25 ]
  const frustum = options.frustum ?? 45
  const mapSize = options.mapSize ?? 2048

  let light: THREE.DirectionalLight | null = null

  /** World units per shadow texel — used to quantise movement. */
  const texelSize = frustum * 2 / mapSize

  return defineModule<RaceState>({
    name: 'sun',

    build (ctx) {
      light = new THREE.DirectionalLight(options.color ?? '#ffffff', options.intensity ?? 1.6)
      light.castShadow = true
      light.shadow.mapSize.set(mapSize, mapSize)

      const cam  = light.shadow.camera
      cam.left   = -frustum
      cam.right  = frustum
      cam.top    = frustum
      cam.bottom = -frustum

      // Derived from the rig rather than fixed at 1..400: the depth range is
      // what shadow-map precision is spent on, and a scene with an 8-unit
      // frustum should not be paying for a 400-unit one. `reach` is how far the
      // light sits from whatever it is aimed at; the frustum multiples cover the
      // box corners at any hull height.
      const reach = Math.hypot(offset[0], offset[1], offset[2])
      cam.near    = Math.max(0.5, reach - frustum * 2)
      cam.far     = reach + frustum * 4
      cam.updateProjectionMatrix()

      // Normal bias handles the sloped track surfaces far better than a constant
      // bias, which either acne-stripes flat ground or peter-pans the hull.
      light.shadow.bias       = -0.0005
      light.shadow.normalBias = 0.02

      light.position.set(offset[0], offset[1], offset[2])
      ctx.scene.add(light)
      ctx.scene.add(light.target)

      handle.current = {
        get light () {
          return light
        },

        follow (position) {
          if (!light)
            return
          // Quantise to whole shadow texels. Without this the shadow map
          // resamples every frame as the camera slides, and the edges crawl —
          // which reads as the whole scene shimmering.
          _target.set(
            Math.round(position.x / texelSize) * texelSize,
            Math.round(position.y / texelSize) * texelSize,
            Math.round(position.z / texelSize) * texelSize
          )
          light.target.position.copy(_target)
          light.target.updateMatrixWorld()
          light.position.set(
            _target.x + offset[0],
            _target.y + offset[1],
            _target.z + offset[2]
          )
        },
      }
    },

    dispose () {
      if (light) {
        light.target.removeFromParent()
        light.removeFromParent()
        light.dispose()
        light = null
      }
      handle.current = null
    },
  })
}
