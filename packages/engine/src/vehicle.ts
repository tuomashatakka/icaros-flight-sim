/**
 * What a scene exposes about its local ship.
 *
 * These used to live in `modules/vehicle.ts`, which OWNED the ship: it built
 * the rapier body, stepped it, wrote telemetry and drove the camera. Both modes
 * are network-backed now and neither uses it — the body belongs to the
 * prediction, and the server owns the motion — so all that survives is the
 * handle the rest of the engine reaches the local ship through, and the debug
 * payload the force overlay draws.
 */

import type RAPIER from '@dimforge/rapier3d-deterministic-compat'
import type { BodyInterpolator } from 'Φinterpolation'
import type { Transform } from 'Φtypes'
import type { ForceSample } from 'Φthrusters'


export type VehicleDebug = {
  racing:       boolean;
  engineForce:  number;
  currentSpeed: number;
  targetSpeed:  number;
  contacts:     number;
  dt:           number;

  /** Every force applied on the last tick, world space. Dev builds only. */
  forces:    readonly ForceSample[];
  netForce:  readonly [number, number, number];
  netTorque: readonly [number, number, number];
}

export type VehicleHandle = {
  readonly body:         RAPIER.RigidBody | null;
  readonly interpolator: BodyInterpolator | null;
  readonly debug:        VehicleDebug | null;

  /** Cut the ship to a transform. Suppresses interpolation across the jump. */
  teleportTo(transform: Transform, liftY?: number): void;
}
