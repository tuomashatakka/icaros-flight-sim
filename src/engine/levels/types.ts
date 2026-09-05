import type * as THREE from 'three'
import type { SceneContext } from 'threejs-scene'
import type { BoxCollider } from '@crash-velocity/physics/colliders'
import type { Physics } from '@crash-velocity/physics/world'

/**
 * A level, as data.
 *
 * Every track is the same five things — waypoints, static colliders, visuals,
 * lights and fog — so they are descriptors rather than four bespoke modules.
 * Geometry is built once, outside `createApp`, and handed to both the visual
 * module and the physics module so neither owns it.
 */
export type LevelSpec = {
  id:         string;
  background: string;

  /** `[color, near, far]`. Set explicitly per level rather than inherited. */
  fog: [string, number, number];

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
