export const COLLISION_GROUPS = {
  GROUND:  1,
  VEHICLE: 2,
}

// `vehicleConfig` moved into the sim layer so the physics stops importing
// upward into app code. Re-exported here because ~15 call sites already point
// at this path and the move is not about churning them.
export { vehicleConfig } from 'Δengine/sim/config'
