import type * as THREE from 'three'
import type { SceneContext } from 'threejs-scene'
import type { BoxCollider } from '@/lib/track/build-track'
import type { Physics } from '../physics/world'
import type { EnvironmentOverrides } from '../scenes/environment'

/**
 * A level, as data.
 *
 * Every track is the same five things — waypoints, static colliders, visuals,
 * lights and fog — so they are descriptors rather than four bespoke modules.
 * Geometry is built once, outside `createApp`, and handed to both the visual
 * module and the physics module so neither owns it.
 */
export type LevelSpec = {
  id: string;

  /**
   * How this track differs from `DEFAULT_ENVIRONMENT`.
   *
   * Sky colour, fog range and the fill tint are level identity; the key-to-fill
   * ratio is not. Every track used to add its own hemisphere light on top of the
   * base rig, which is what buried the ship's shadow — so a level states deltas
   * here and never adds an ambient light of its own. Point lights placed in
   * `build` are still fine: those are set dressing, not fill.
   */
  environment: EnvironmentOverrides;

  /** Ordered centreline; checkpoint 0 is the start/finish line. */
  waypoints: THREE.Vector3[];

  /** Full road width, so gates span the track. */
  width: number;
  laps:  number;
  loop:  boolean;

  /** Drivable surface + walls, as oriented cuboids (never a trimesh). */
  colliders: BoxCollider[];

  /** World offset applied to the whole collider set. */
  colliderOffset: [number, number, number];

  /** Scene content. Physics is passed for levels that need extra bodies. */
  build(ctx: SceneContext, physics: Physics): void;

  bloom: { strength: number; threshold: number; radius: number };
}

export type LevelId = 'flats' | 'procedural' | 'neon-canyon' | 'orbital-ring'
