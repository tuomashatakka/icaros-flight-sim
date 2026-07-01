
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const COLLISION_GROUPS = {
  GROUND: 1,
  VEHICLE: 2,
};

// --- Anti-grav hover-racer tuning -------------------------------------------
// The Rapier raycast-vehicle controller is repurposed as a HOVER + GRIP engine:
//   - long suspension rest length = the float height (the "anti-grav")
//   - wheel ray contacts = ground-follow (never clips the box-strip track)
//   - side friction = the carve that resists sliding out of a turn
// Steering is a SINGLE yaw source (driven angular velocity about the ship's up),
// and orientation aligns the ship's up to the averaged track surface normal, so
// the ship banks into banked corners and self-rights on flat ground.
export const vehicleConfig = {
  // chassis
  width: 1.0,
  height: 0.225,
  front: 1.35,
  back: -1.3,
  mass: 120,

  // hover suspension — the "anti-grav" float
  hoverHeight: 0.7,         // suspension rest length = ride height above track
  suspensionStiffness: 26,  // higher = firmer float, less bob
  suspensionTravel: 0.5,
  suspensionCompression: 3.2,
  suspensionRelaxation: 5.5,
  wheelRadius: 0.35,

  // thrust & grip
  thrust: 950,              // AWD engine force per wheel
  forwardGrip: 2.2,         // longitudinal friction slip
  sideGrip: 3.0,            // lateral carve — resists sliding out of turns
  maxSpeed: 55,             // cruise ceiling (m/s), ~200 km/h

  // steering & orientation — ONE yaw source, surface-aligned tilt
  maxYawRate: 2.4,          // rad/s peak turn rate on the ground
  yawResponse: 6,           // how fast yaw eases toward the input target
  highSpeedYawScale: 0.55,  // fraction of yaw rate retained at top speed
  uprightStrength: 8,       // gain pulling ship-up toward the surface normal
  maxBank: 0.5,             // peak cosmetic lean into a turn (rad)
  airYawRate: 1.6,          // aftertouch yaw authority while airborne
  airLevelStrength: 2.5,    // self-level toward world-up when airborne
  maxTiltRate: 10,          // clamp on orientation-correction angular speed

  // boost
  boostThrustMultiplier: 2.1,
  boostSpeedMultiplier: 1.55,
  boostYawMultiplier: 1.2,
  boostDrainRate: 0.45,
  boostRechargeRate: 0.18,

  // crash detection
  crashDecel: 42,
  crashMinSpeed: 14,
};
