/**
 * Copy the predicted step's readings onto the telemetry the HUD draws.
 *
 * Race and battle both run one predicted local chassis and both needed the
 * same eight lines to publish it, so they each had a copy — and the copies
 * drifted, which is the whole argument for this file existing. Battle's copy
 * never learned about `thrustCommand` or `gLoad` when those were added, while
 * battle's HUD reads both: the propulsion panel and the FPV label each showed a
 * flat `0.0G`, and the throttle bar sat at zero, for as long as the two blocks
 * were maintained separately.
 *
 * `prediction` is nullable because a scene publishes every frame, including the
 * ones before the local ship exists.
 */

import type { LocalPrediction } from './prediction'
import type { Telemetry } from '../telemetry'
import type RAPIER from '@dimforge/rapier3d-deterministic-compat'


export function publishTelemetry (
  telemetry:  Telemetry,
  chassis:    RAPIER.RigidBody,
  prediction: LocalPrediction | null,
  boosting:   boolean
): void {
  const velocity = chassis.linvel()

  // Ground speed, deliberately: the vertical component is hover bob and a
  // speedometer that counts it reads as noise on every crest.
  telemetry.speed         = Math.hypot(velocity.x, velocity.z)
  telemetry.boostMeter    = prediction?.boost ?? 1
  telemetry.boosting      = boosting
  telemetry.grounded      = prediction?.grounded ?? false
  telemetry.airbrake      = prediction?.airbrake ?? 0
  telemetry.thrustCommand = prediction?.thrustCommand ?? 0
  telemetry.gLoad         = prediction?.gLoad ?? 0
  telemetry.velocity.set(velocity.x, velocity.y, velocity.z)
}
