import type RAPIER from '@dimforge/rapier3d-compat';
import type { Rapier } from '../rapier';
import { STEP } from '../clock';
import type { BodyInterpolator } from '../interpolation';

export type Physics = {
  RAPIER: Rapier;
  world: RAPIER.World;
  eventQueue: RAPIER.EventQueue;
  /** Bodies sampled at render time. Registered by whoever creates them. */
  interpolators: BodyInterpolator[];
  free(): void;
};

/**
 * Create the rapier world.
 *
 * Deliberately NOT an `AppModule`. `createApp` builds and updates modules from
 * the same ordered array, so "built before everything, stepped after everything"
 * is unsatisfiable as a module — the world is built here and injected into the
 * modules that need it, the same way the reference template injects its camera
 * rig and telemetry.
 */
export function createPhysics(RAPIER: Rapier): Physics {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = STEP;

  const eventQueue = new RAPIER.EventQueue(true);
  const interpolators: BodyInterpolator[] = [];

  return {
    RAPIER,
    world,
    eventQueue,
    interpolators,
    free() {
      eventQueue.free();
      world.free();
    },
  };
}
