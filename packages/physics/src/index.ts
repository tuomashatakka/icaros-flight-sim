/**
 * The ship's physics, as a package.
 *
 * Everything in here depends on `three` and `@dimforge/rapier3d-deterministic-compat` and
 * nothing else — no React, no zustand, no DOM, no three.js scene graph. That is
 * the point of it being a package rather than a directory: the boundary is now
 * enforced by resolution rather than by remembering. It used to import a
 * four-line `Transform` type from a zustand store module, which is exactly the
 * kind of edge that makes a "shared" simulation quietly un-shareable.
 *
 * Two hosts consume it: the browser (race, the battle client's prediction, and
 * the crash lab) and the Bun battle server. Neither is allowed to be special.
 */
export { vehicleConfig } from './config'

export { DEFAULT_TUNING } from './types'
export type { ShipTuning, Transform } from './types'

export {
  AIRBRAKE_PANELS,
  DOWNFORCE,
  DRAG,
  INERTIA,
  LATERAL_L,
  LATERAL_R,
  LIFT_INDICES,
  MAIN_L,
  MAIN_R,
  MAIN_THRUST_CAPACITY,
  RCS_L,
  RCS_R,
  RETRO_L,
  RETRO_R,
  THRUSTER_RIG,
} from './thrusters'
export type { AirbrakePanel, ForceGroup, ForceSample, Thruster, ThrusterGroup } from './thrusters'

export { createHovercraft, createHovercraftState, stepHovercraft } from './vehicle-step'
export type {
  HovercraftInput,
  HovercraftRig,
  HovercraftState,
  HovercraftStepParams,
  HovercraftStepResult,
} from './vehicle-step'

export { CRASH_CASES, LANE_PITCH, caseById } from './lab/cases'
export type {
  CrashCase,
  LabCheck,
  LabFrame,
  LabKeyframe,
  LabProp,
  LabSolid,
  LabTrace,
  WindField,
} from './lab/cases'

export { runAllCrashCases, runCrashCase } from './lab/run'
export type { LabRunOptions } from './lab/run'

// The headless engine core. These moved out of `src/engine/` when race and
// battle both became server-side: a rapier world, a fixed clock and a collider
// helper are the simulation's, not the browser's.
export { initRapier } from './rapier'
export type { Rapier } from './rapier'
export { MAX_SUB_STEPS, STEP, createSimClock } from './clock'
export type { Clock, SimClock } from './clock'
export { BodyInterpolator } from './interpolation'
export { createPhysics } from './world'
export type { Physics } from './world'
export { attachBox, attachBoxColliders } from './colliders'
export { DEFAULT_SHIP_ID, SHIP_IDS, isShipId } from './ships'
export type { ShipId } from './ships'
export type { BoxCollider } from './colliders'
export { mulberry32 } from './rng'
