/**
 * Ship tuning constants.
 *
 * Lives in the physics package, not in `lib/utils`, because the physics must
 * not import upward. `@/lib/utils` re-exports it for the call sites that
 * already point there, so the app keeps its import path while the dependency
 * edge points the right way round.
 */

// --- Anti-grav hover-racer tuning -------------------------------------------
// The ship is a thruster rig (see `thrusters.ts`). These numbers are the inputs
// the rig and the flight-control loops are sized against:
//   - `hoverHeight` / `suspension*` shape the four hover-pad springs
//   - `thrust` is the total main-engine force, split across two nozzles
//   - `sideGrip` scales the lateral drag that stops a turn becoming a slide
//   - `maxYawRate` / `yawResponse` / `uprightStrength` are FCS gains, not caps
// Several of these keep names from the raycast-vehicle era on purpose: the live
// tuning panel and every saved preset are keyed by them.
export const vehicleConfig = {
  // chassis
  width:  1.0,
  height: 0.225,
  front:  1.35,
  back:   -1.3,
  mass:   120,

  // hover suspension — the "anti-grav" float
  hoverHeight:           0.7, // suspension rest length = ride height above track
  suspensionStiffness:   26, // higher = firmer float, less bob
  suspensionTravel:      0.5,
  suspensionCompression: 3.2,
  suspensionRelaxation:  5.5,
  wheelRadius:           0.35,

  // thrust & grip
  thrust:           950, // AWD engine force per wheel
  forwardGrip:      2.2, // longitudinal friction slip
  sideGrip:         3.0, // lateral carve — resists sliding out of turns
  maxSpeed:         55, // cruise ceiling (m/s), ~200 km/h
  strafeSpeedScale: 0.14, // lateral top speed as a fraction of cruise speed
  strafeResponse:   8, // lateral velocity response; lower avoids instant lane snaps

  // steering & orientation — ONE yaw source, surface-aligned tilt
  maxYawRate:        1.45, // rad/s peak turn rate on the ground
  yawResponse:       4.5, // how fast yaw eases toward the input target
  highSpeedYawScale: 0.5, // fraction of yaw rate retained at top speed
  uprightStrength:   8, // gain pulling ship-up toward the surface normal
  maxBank:           0.5, // peak cosmetic lean into a turn (rad)
  airYawRate:        1.0, // aftertouch yaw authority while airborne
  airLevelStrength:  2.5, // self-level toward world-up when airborne
  maxTiltRate:       10, // clamp on orientation-correction angular speed

  // boost
  boostThrustMultiplier: 2.1,
  boostSpeedMultiplier:  1.55,
  boostYawMultiplier:    1.05,
  boostDrainRate:        0.45,
  boostRechargeRate:     0.18,

  // crash detection
  crashDecel:    42,
  crashMinSpeed: 14,
}
