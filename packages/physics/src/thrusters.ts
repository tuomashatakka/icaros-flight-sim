import { vehicleConfig } from './config'

/**
 * The ship's propulsion hardware, as data.
 *
 * Every control the player has is a request for one of these to fire. Nothing
 * in the sim sets a velocity or an angular velocity directly any more: the
 * vehicle step decides a throttle per thruster, applies `addForceAtPoint` at the
 * mount, and whatever the ship then does is rapier integrating `tau = r x F`
 * against the real inertia tensor.
 *
 * That is the whole point of the placement below. A lateral thruster bolted to
 * the tail cannot strafe without also yawing, because a force off the centre of
 * mass is a torque — so the coupling is not a feel hack layered on top, it is
 * the arithmetic. Move a mount and the handling changes; there is no second
 * place to go and correct it.
 *
 * Body axes: +X right, +Y up, +Z forward.
 */

export type ThrusterGroup = 'main' | 'retro' | 'lateral' | 'lift' | 'rcs'

/** What a force arrow can be tagged as, for the debug overlay. */
export type ForceGroup = ThrusterGroup | 'airbrake' | 'drag' | 'attitude' | 'wind'

export type Thruster = {
  id:    string;
  group: ThrusterGroup;

  /** Mount point, body-local metres. Its offset from the COM IS the torque. */
  pos: readonly [number, number, number];

  /** Unit vector the thrust PUSHES THE SHIP along, body-local. */
  dir: readonly [number, number, number];

  /** Newtons at throttle 1. */
  maxForce: number;
}

const { width, height, front, back, mass, thrust } = vehicleConfig

const HALF_W = width / 2
const PAD_Y  = -height / 2

// Weight is the only honest reference for a hover pad: four of them hold the
// ship up, so anything below mass*g/4 each cannot fly and the surplus above it
// is the entire attitude-control budget.
//
// Capped at HALF a weight each, and that number is load-bearing. Four pads then
// top out at 2x weight, so the most the hover can ever do is cancel gravity and
// push back with 1 g — which means the ship physically cannot rebound higher
// than it fell. At 1x weight each it could, and a race spawn drops the hull 2.5 m
// (checkpoint y + 1.5, then another +1 on teleport), so every single scenario
// run began by launching the ship into orbit off its own suspension.
const WEIGHT = mass * 9.81
const LIFT   = WEIGHT * 0.5

// `thrust` was per-wheel engine force across four wheels; two mains inherit the
// same total so top speed lands in the same place it used to.
const MAIN  = thrust * 2
const RETRO = MAIN * 0.55
// Strafe is SUPPOSED to swing the nose — that is why the nozzles are at the
// tail. But the arm is over a metre, so full lateral thrust out-torques the yaw
// jets outright and the ship just spins. Sized instead so the induced yaw stays
// inside what a counter-steer can cancel: strafing costs you heading, and you
// can choose to pay it back.
const LATERAL = MAIN * 0.22

// Sized against the yaw inertia, not picked by feel: reaching `maxYawRate` in
// roughly a third of a second needs tau = I_yy * 4.4 rad/s^2, and the moment arm
// is the tail offset. Doubled for headroom, since the PD only ever asks for a
// fraction of it.
const RCS = 620

// Lateral nozzles cant slightly UP. A force with +Y applied behind the COM lifts
// the tail, which drops the nose — the "front tip nudges down when you strafe"
// the brief asks for. Canting them down would pitch the nose UP instead; the
// sign is not arbitrary and it is easy to get backwards.
const LATERAL_CANT = 0.42
const LATERAL_NORM = Math.hypot(1, LATERAL_CANT)

const lateral = (sign: number): readonly [number, number, number] => [
  sign / LATERAL_NORM,
  LATERAL_CANT / LATERAL_NORM,
  0,
]

/**
 * Mount points, and what each one buys.
 *
 * `main` / `retro` sit as a symmetric pair either side of the centreline, so
 * balanced throttle is pure translation and DIFFERENTIAL throttle is free yaw
 * authority — no dedicated steering jet needed until the mains saturate.
 *
 * `lateral` sits behind the COM and above it, which is where all three coupled
 * behaviours come from at once (taking a rightward push, F = +X):
 *   tau_y = r_z * F_x  ->  r_z < 0, so the nose swings toward the strafe
 *   tau_z = -r_y * F_x ->  r_y > 0, so the ship banks INTO the strafe
 *   tau_x = -r_z * F_y ->  the +Y cant drops the nose
 * `test/thrusters.test.ts` pins those three signs, because they are the design.
 *
 * `lift` sits at the four corners at the old wheel positions. Corner mounting is
 * what makes surface-following emergent: one pad over a rise pushes harder than
 * its diagonal opposite and the hull pitches without anyone asking it to.
 */
export const THRUSTER_RIG: readonly Thruster[] = [
  { id: 'main.L', group: 'main', pos: [ -0.34, 0, back + 0.15 ], dir: [ 0, 0, 1 ], maxForce: MAIN },
  { id: 'main.R', group: 'main', pos: [ 0.34, 0, back + 0.15 ], dir: [ 0, 0, 1 ], maxForce: MAIN },

  { id: 'retro.L', group: 'retro', pos: [ -0.34, 0, front - 0.25 ], dir: [ 0, 0, -1 ], maxForce: RETRO },
  { id: 'retro.R', group: 'retro', pos: [ 0.34, 0, front - 0.25 ], dir: [ 0, 0, -1 ], maxForce: RETRO },

  // Named for the direction they push the SHIP, not the flank they bolt to —
  // the one that shoves you left is mounted starboard, exhaust pointing out.
  { id: 'lateral.L', group: 'lateral', pos: [ 0.3, 0.12, back + 0.25 ], dir: lateral(-1), maxForce: LATERAL },
  { id: 'lateral.R', group: 'lateral', pos: [ -0.3, 0.12, back + 0.25 ], dir: lateral(1), maxForce: LATERAL },

  // Yaw jets. Mounted at the extreme tail on the roll axis (y = 0), so steering
  // torques the ship without also rolling it — that coupling belongs to strafe,
  // which is a different control with a different feel. A single tail jet does
  // push the tail sideways as well as rotate it, and that is correct for a craft
  // with no bow thruster: you steer by kicking the back out. Lateral drag is ~24x
  // longitudinal, so the slide is suppressed into a turn rather than a skid.
  { id: 'rcs.L', group: 'rcs', pos: [ 0.28, 0, back ], dir: [ -1, 0, 0 ], maxForce: RCS },
  { id: 'rcs.R', group: 'rcs', pos: [ -0.28, 0, back ], dir: [ 1, 0, 0 ], maxForce: RCS },

  { id: 'lift.FL', group: 'lift', pos: [ -HALF_W, PAD_Y, front ], dir: [ 0, 1, 0 ], maxForce: LIFT },
  { id: 'lift.FR', group: 'lift', pos: [ HALF_W, PAD_Y, front ], dir: [ 0, 1, 0 ], maxForce: LIFT },
  { id: 'lift.RL', group: 'lift', pos: [ -HALF_W, PAD_Y, back ], dir: [ 0, 1, 0 ], maxForce: LIFT },
  { id: 'lift.RR', group: 'lift', pos: [ HALF_W, PAD_Y, back ], dir: [ 0, 1, 0 ], maxForce: LIFT },
]

/**
 * Combined main-nozzle force at full throttle, newtons.
 *
 * The normaliser for `HovercraftStepResult.engineForce`, so a gauge can show
 * commanded thrust as a fraction without knowing the rig. Derived from the rig
 * rather than written down twice: adding a main nozzle must not silently peg
 * every readout at 100 %.
 */
export const MAIN_THRUST_CAPACITY = THRUSTER_RIG.reduce(
  (total, t) => t.group === 'main' ? total + t.maxForce : total,
  0
)

/** Index of the four hover pads, in rig order. Hot path — resolved once. */
export const LIFT_INDICES = THRUSTER_RIG.reduce<number[]>((acc, t, i) => {
  if (t.group === 'lift')
    acc.push(i)
  return acc
}, [])

export const MAIN_L    = THRUSTER_RIG.findIndex(t => t.id === 'main.L')
export const MAIN_R    = THRUSTER_RIG.findIndex(t => t.id === 'main.R')
export const RETRO_L   = THRUSTER_RIG.findIndex(t => t.id === 'retro.L')
export const RETRO_R   = THRUSTER_RIG.findIndex(t => t.id === 'retro.R')
export const LATERAL_L = THRUSTER_RIG.findIndex(t => t.id === 'lateral.L')
export const LATERAL_R = THRUSTER_RIG.findIndex(t => t.id === 'lateral.R')
export const RCS_L     = THRUSTER_RIG.findIndex(t => t.id === 'rcs.L')
export const RCS_R     = THRUSTER_RIG.findIndex(t => t.id === 'rcs.R')

/**
 * Wing air brakes: drag panels, not thrusters, so their force depends on how
 * fast you are already going and points against travel rather than along a
 * nozzle. Mounted outboard, so a one-sided deploy yaws the ship.
 */
export type AirbrakePanel = {
  id:  string;
  pos: readonly [number, number, number];

  /** Effective `Cd * A` when fully deployed, in m^2. */
  dragArea: number;
}

export const AIRBRAKE_PANELS: readonly AirbrakePanel[] = [
  { id: 'airbrake.L', pos: [ -0.82, 0.06, -0.35 ], dragArea: 1.1 },
  { id: 'airbrake.R', pos: [ 0.82, 0.06, -0.35 ], dragArea: 1.1 },
]

/**
 * Body-frame drag, as a coefficient per axis: `F = -k * v * |v|` per component.
 *
 * Deliberately anisotropic, and that anisotropy is the hovercraft's "grip". A
 * hull slips forward easily and resists being shoved sideways, so lateral drag
 * is over an order of magnitude stiffer than longitudinal — that is what stops
 * the ship washing out of a corner, and it is the honest version of the
 * `sideGrip` friction number the raycast wheels used to carry.
 *
 * `long` is set so thrust and drag balance a little ABOVE `maxSpeed`. Balancing
 * exactly at it means the throttle governor — which eases off over the last 12%
 * — is fighting drag for the same job and the ship tops out ~10% short. Drag
 * shapes how it gets there; the governor decides where it stops.
 */
const TERMINAL = vehicleConfig.maxSpeed * 1.18

export const DRAG = {
  long: MAIN * 2 / (TERMINAL * TERMINAL),
  lat:  0,
  vert: 0,
}

/**
 * Downforce coefficient: `F = -DOWNFORCE * v^2` along body-down.
 *
 * Not decoration. A hover pad is a thruster, so it can push the hull UP and
 * nothing else — once the ship crests a rise and the pads run out of reach there
 * is literally no force available to put it back on the track, and it ramps off
 * every undulation and keeps going. Real racers solve this with wings, and so
 * does this one: at top speed the ship makes about 0.6 g of downforce, which
 * keeps it planted over crests, pulls it back down faster when it does get air,
 * and makes it squat visibly as it accelerates.
 *
 * Sized in units of weight-at-top-speed, so it stays sane if the hull mass moves.
 */
export const DOWNFORCE = WEIGHT * 0.6 / (vehicleConfig.maxSpeed * vehicleConfig.maxSpeed)
DRAG.lat  = DRAG.long * 7
DRAG.vert = DRAG.long * 3

/**
 * Principal moments of inertia for the chassis cuboid, kg*m^2.
 *
 * Computed from the same box `createHovercraft` builds its collider from, rather
 * than read back off rapier: the PD gains are sized against these, and a gain
 * that silently changes when a collider dimension moves is the kind of coupling
 * that costs an afternoon.
 */
const BOX_L = front * 2

export const INERTIA = {
  pitch: mass / 12 * (height * height + BOX_L * BOX_L),
  yaw:   mass / 12 * (width * width + BOX_L * BOX_L),
  roll:  mass / 12 * (width * width + height * height),
}

/** One applied force, body-local, for the debug overlay. */
export type ForceSample = {
  id:     string;
  group:  ForceGroup;
  point:  [number, number, number];
  vector: [number, number, number];
}
