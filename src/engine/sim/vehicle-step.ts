import { MathUtils, Quaternion, Vector3 } from 'three'
import RAPIER from '@dimforge/rapier3d-compat'
import { vehicleConfig } from '@/lib/utils'
import type { Transform } from '@/hooks/use-race-store'
import type { ShipTuning } from '../state'

// ---------------------------------------------------------------------------
// FEEL KNOB — cosmetic lean into a turn (the signature of an anti-grav racer).
// Returns a roll angle (rad) around the ship's forward axis: the ship dips its
// inside edge into the corner. This is a *design* decision — there is no single
// right answer. Some shapes to try:
//   linear:  steerNorm * maxBank * speedRatio                 (current default)
//   eased:   Math.sign(steerNorm) * steerNorm*steerNorm * maxBank * speedRatio
//            -> softer near-centre, snappier at full lock
//   gated:   speedRatio < 0.3 ? 0 : steerNorm * maxBank
//            -> only leans once you're actually moving
function computeBankAngle (steerNorm: number, speedRatio: number, maxBank: number): number {
  return steerNorm * maxBank * speedRatio
}

/** Module-scope scratch — mutated each step, never reallocated. */
const WORLD_UP    = new Vector3(0, 1, 0)
const _fwd        = new Vector3()
const _up         = new Vector3()
const _surfNormal = new Vector3()
const _targetUp   = new Vector3()
const _axis       = new Vector3()
const _tiltOmega  = new Vector3()
const _yawOmega   = new Vector3()
const _targetAngv = new Vector3()
const _tmp        = new Vector3()
const _tmpQuat    = new Quaternion()
const _bankQuat   = new Quaternion()

/**
 * Per-ship smoothed state that must survive between ticks.
 *
 * Holds the same three accumulators the R3F body kept in closure scope. The
 * caller owns the struct so it can also keep per-ship state when the battle
 * server steps several hovercraft in one world.
 */
export type HovercraftState = {
  smoothedYawRate: number;
  prevSpeed:       number;
  crashCooldown:   number;
}

export function createHovercraftState (): HovercraftState {
  return { smoothedYawRate: 0, prevSpeed: 0, crashCooldown: 0 }
}

/** Raw control values, team-agnostic. Sign conventions live in the vehicle. */
export type HovercraftInput = {
  steer:    number;
  throttle: boolean;
  brake:    boolean;
  boost:    boolean;
  reverse?: boolean;
  strafe?:  number;
}

/** Everything the caller needs to know about one step, in one object. */
export type HovercraftStepResult = {
  speed:       number;
  boostMeter:  number;
  grounded:    boolean;
  boosting:    boolean;
  engineForce: number;
  contacts:    number;

  /** How many crash events fired this step (0 or 1). */
  crashDelta: number;
  shake:      number;
  respawned:  boolean;
}

export type HovercraftStepParams = {
  chassis:    RAPIER.RigidBody;
  controller: RAPIER.DynamicRayCastVehicleController;
  input:      HovercraftInput;
  tuning:     ShipTuning;
  state:      HovercraftState;
  dt:         number;

  /** Whether driving input is live ("GO"). Zeroes thrust/steer when false. */
  allowDrive: boolean;

  /** Where the ship teleports on reset / fall-through. */
  spawn: Transform;

  /** A teleport/respawn was requested this tick (edge-triggered upstream). */
  resetRequested: boolean;

  /** Current boost reserve 0..1, in and out. */
  boostMeter: number;

  // The speed the hover engines push toward. The race scene drives this from
  //  zone escalation; battle just passes the hull max.
  targetSpeed: number;
}

export type HovercraftRig = {
  chassis:    RAPIER.RigidBody;
  controller: RAPIER.DynamicRayCastVehicleController;
}

/**
 * Build one hovercraft body + raycast controller, configured identically for
 * the race scene and the headless battle server — the four invisible hover pads
 * and their suspension/grip tuning live in exactly one place.
 */
export function createHovercraft (
  world: RAPIER.World,
  at: Transform = { position: [ 1, 2, 4 ], quaternion: [ 0, 1, 0, 0 ]}
): HovercraftRig {
  const { width, height, front, back, wheelRadius } = vehicleConfig
  const { position, quaternion }                    = at

  const chassis = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position[0], position[1], position[2])
      .setRotation({
        x: quaternion[0],
        y: quaternion[1],
        z: quaternion[2],
        w: quaternion[3],
      })
      .setLinearDamping(0.1)
      .setAngularDamping(0.5)
      .setCcdEnabled(true)
      .setCanSleep(false)
  )
  chassis.userData = { isVehicle: true }

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(width / 2, height / 2, front).setMass(vehicleConfig.mass),
    chassis
  )

  // Wheel chassis-connection points, local space:
  // [front-left, front-right, back-left, back-right].
  const wheels = [
    { x: -width / 2, y: -height / 2, z: front },
    { x: width / 2, y: -height / 2, z: front },
    { x: -width / 2, y: -height / 2, z: back },
    { x: width / 2, y: -height / 2, z: back },
  ]

  // The wheels are invisible hover pads: pure suspension + grip, no steering
  // and no per-wheel braking (turning is a single yaw source, applied in step).
  const controller               = world.createVehicleController(chassis)
  controller.indexUpAxis         = 1
  controller.setIndexForwardAxis = 2

  const down = { x: 0, y: -1, z: 0 }
  const axle = { x: -1, y: 0, z: 0 }
  for (const pos of wheels)
    controller.addWheel(pos, down, axle, vehicleConfig.hoverHeight, wheelRadius)
  for (let i = 0; i < wheels.length; i++) {
    controller.setWheelSuspensionStiffness(i, vehicleConfig.suspensionStiffness)
    controller.setWheelMaxSuspensionTravel(i, vehicleConfig.suspensionTravel)
    controller.setWheelSuspensionCompression(i, vehicleConfig.suspensionCompression)
    controller.setWheelSuspensionRelaxation(i, vehicleConfig.suspensionRelaxation)
    controller.setWheelMaxSuspensionForce(i, 100000)
    controller.setWheelFrictionSlip(i, vehicleConfig.forwardGrip)
    controller.setWheelSideFrictionStiffness(i, vehicleConfig.sideGrip)
  }

  return { chassis, controller }
}

/**
 * Step one hovercraft for one fixed 1/60 s tick.
 *
 * Extracted verbatim from the race vehicle module so the server-authoritative
 * battle sim runs the SAME physics as the single-player race — one hover math,
 * two hosts. The extract is deliberate about NOT touching Rapier world state or
 * telemetry: pose changes (linvel/angvel/translation) are the only mutations,
 * everything else is computed and returned.
 *
 * The race scene and the battle server each construct their own scratch vectors
 * (module scope here), so running several ships in one world stays safe.
 */
export function stepHovercraft (params: HovercraftStepParams): HovercraftStepResult {
  const {
    chassis,
    controller,
    input,
    tuning: t,
    state: s,
    dt,
    allowDrive,
    spawn,
    resetRequested,
    boostMeter,
    targetSpeed: baseTarget,
  }                             = params
  const {
    maxSpeed,
    yawResponse,
    highSpeedYawScale,
    airYawRate,
    airLevelStrength,
    maxTiltRate,
    boostThrustMultiplier,
    boostSpeedMultiplier,
    boostYawMultiplier,
    boostDrainRate,
    boostRechargeRate,
    crashDecel,
    crashMinSpeed,
  }                             = vehicleConfig

  // Teleport to the respawn point on request or after a fall-through. Pose-only:
  // the caller owns the interpolator and camera snap so it can decide to fire
  // those per ship.
  const teleport = () => {
    const { position, quaternion } = spawn
    chassis.setTranslation({ x: position[0], y: position[1] + 1, z: position[2] }, true)
    chassis.setRotation(
      { x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3] },
      true
    )
    chassis.setLinvel({ x: 0, y: 0, z: 0 }, true)
    chassis.setAngvel({ x: 0, y: 0, z: 0 }, true)
    s.smoothedYawRate = 0
  }

  let respawned = false
  if (resetRequested || chassis.translation().y < -40) {
    teleport()
    respawned = true
  }

  const lv           = chassis.linvel()
  const currentSpeed = Math.hypot(lv.x, lv.y, lv.z)

  // Boost reserve: drains while held (and available), recharges otherwise.
  const boosting       = allowDrive && input.boost && boostMeter > 0
  const nextBoostMeter = Math.max(
    0,
    Math.min(1, boostMeter + (boosting ? -boostDrainRate : boostRechargeRate) * dt)
  )

  const targetSpeed = boosting ? baseTarget * boostSpeedMultiplier : baseTarget
  const speedRatio  = Math.min(currentSpeed / Math.max(targetSpeed, 1), 1)

  // Apply live hover/grip tuning so the debug panel updates the float in real time.
  for (let i = 0; i < 4; i++) {
    controller.setWheelSuspensionRestLength(i, t.hoverHeight)
    controller.setWheelSuspensionStiffness(i, t.suspensionStiffness)
    controller.setWheelSideFrictionStiffness(i, t.sideGrip)
  }

  // Thrust: all-wheel engine force, gated on the throttle being HELD (the
  // ship does not accelerate on its own), on "GO", and capped at target
  // speed. Engine force only bites while wheels touch ground, so it
  // self-cuts in the air.
  const isReversing  = allowDrive && (input.reverse || input.brake && currentSpeed < 5)
  const isBraking    = allowDrive && input.brake && !isReversing
  const driveForce   = boosting ? t.thrust * boostThrustMultiplier : t.thrust
  const throttleOpen = !isBraking && !isReversing && (input.throttle || boosting)
  const engineForce  = allowDrive && throttleOpen && currentSpeed < targetSpeed ? driveForce : isReversing ? -driveForce * 0.6 : 0
  const brakeForce   = isBraking ? 180 : 0

  for (let i = 0; i < 4; i++) {
    controller.setWheelEngineForce(i, engineForce)
    controller.setWheelSteering(i, 0)
    controller.setWheelBrake(i, brakeForce)
  }

  // Lateral strafe force & velocity override
  const strafeVal = allowDrive && input.strafe ? input.strafe : 0
  if (strafeVal !== 0) {
    const rNow = chassis.rotation()
    _tmpQuat.set(rNow.x, rNow.y, rNow.z, rNow.w)
    _fwd.set(0, 0, 1).applyQuaternion(_tmpQuat)

    const right = _tmp.set(1, 0, 0).applyQuaternion(_tmpQuat)

    const curLv             = chassis.linvel()
    const fwdSpeed          = curLv.x * _fwd.x + curLv.z * _fwd.z
    const targetStrafeSpeed = strafeVal * maxSpeed * 0.2

    const targetVx = _fwd.x * fwdSpeed + right.x * targetStrafeSpeed
    const targetVz = _fwd.z * fwdSpeed + right.z * targetStrafeSpeed

    const lerpRate = 1 - Math.exp(-14 * dt)
    const finalVx  = MathUtils.lerp(curLv.x, targetVx, lerpRate)
    const finalVz  = MathUtils.lerp(curLv.z, targetVz, lerpRate)

    chassis.setLinvel({ x: finalVx, y: curLv.y, z: finalVz }, true)
  }

  // Step the suspension + friction solver. After this, wheel contacts are valid.
  controller.updateVehicle(dt)

  // --- Surface-aware orientation ----------------------------------------
  // Average the wheel contact normals to get the track surface under the ship.
  _surfNormal.set(0, 0, 0)

  let contacts = 0
  for (let i = 0; i < 4; i++)
    if (controller.wheelIsInContact(i)) {
      const n = controller.wheelContactNormal(i)
      if (n) {
        _surfNormal.add(_tmp.set(n.x, n.y, n.z))
        contacts++
      }
    }

  const grounded = contacts > 0
  if (grounded)
    _surfNormal.normalize()
  else
    _surfNormal.copy(WORLD_UP)

  // Current orientation basis.
  const rNow = chassis.rotation()
  _tmpQuat.set(rNow.x, rNow.y, rNow.z, rNow.w)
  _fwd.set(0, 0, 1).applyQuaternion(_tmpQuat)
  _up.set(0, 1, 0).applyQuaternion(_tmpQuat)

  // Eased single yaw source. steer in [-1, 1], positive = right.
  //
  // NEGATED here on purpose, and this is the only place the sign lives: yaw
  // is driven about the ship's own UP axis, and a positive rotation about +Y
  // is counter-clockwise seen from above — i.e. a LEFT turn. Without the
  // negation, "steer right" turns the ship left. Fixing it here rather than
  // in the input layer keeps one convention for keyboard, drag and any
  // future gamepad.
  const steerInput    = allowDrive ? -input.steer : 0
  const yawSpeedScale = MathUtils.lerp(1, highSpeedYawScale, speedRatio)
  const boostYawMul   = input.boost ? boostYawMultiplier : 1
  const desiredYaw    = grounded
    ? steerInput * t.maxYawRate * yawSpeedScale * boostYawMul
    : steerInput * airYawRate
  const yawLerp     = 1 - Math.exp(-yawResponse * dt)
  s.smoothedYawRate = MathUtils.lerp(s.smoothedYawRate, allowDrive ? desiredYaw : 0, yawLerp)

  const yawRate = s.smoothedYawRate

  // Cosmetic bank: lean the target-up into the turn and strafe direction.
  const steerNorm  = Math.max(-1, Math.min(1, yawRate / Math.max(t.maxYawRate, 1e-3)))
  const bankAngle  = grounded ? computeBankAngle(steerNorm, speedRatio, t.maxBank) : 0
  const strafeNorm = allowDrive && input.strafe ? input.strafe : 0
  const strafeBank = strafeNorm * t.maxBank * 0.75

  _bankQuat.setFromAxisAngle(_fwd, -(bankAngle + strafeBank))
  _targetUp.copy(_surfNormal).applyQuaternion(_bankQuat)
    .normalize()

  // Tilt correction: angular velocity that rotates ship-up toward target-up.
  // The cross product gives the (pitch/roll) axis; it never contains a yaw
  // component, so driven yaw stays clean. Strength is a P-gain.
  _axis.crossVectors(_up, _targetUp)

  const sinA      = _axis.length()
  const cosA      = Math.max(-1, Math.min(1, _up.dot(_targetUp)))
  const tiltAngle = Math.atan2(sinA, cosA)
  if (sinA > 1e-5)
    _axis.multiplyScalar(1 / sinA)
  else
    _axis.set(0, 0, 0)

  const tiltStrength = grounded ? t.uprightStrength : airLevelStrength
  _tiltOmega.copy(_axis).multiplyScalar(tiltAngle * tiltStrength)
  if (_tiltOmega.length() > maxTiltRate)
    _tiltOmega.setLength(maxTiltRate)

  // Driven yaw about the ship's own up (so turns stay in the track plane when banked).
  _yawOmega.copy(_up).multiplyScalar(yawRate)

  // Final target angular velocity = driven yaw + surface-alignment tilt.
  _targetAngv.copy(_yawOmega).add(_tiltOmega)
  chassis.setAngvel({ x: _targetAngv.x, y: _targetAngv.y, z: _targetAngv.z }, true)

  // Safety net: never let a solver glitch fling the body past a sane speed.
  const lvNow    = chassis.linvel()
  const spNow    = Math.hypot(lvNow.x, lvNow.y, lvNow.z)
  const speedCap = maxSpeed * boostSpeedMultiplier * 1.4
  if (spNow > speedCap) {
    const scale = speedCap / spNow
    chassis.setLinvel({ x: lvNow.x * scale, y: lvNow.y * scale, z: lvNow.z * scale }, true)
  }

  // A sharp drop in speed from a fast-enough run reads as an impact.
  const decel = (s.prevSpeed - currentSpeed) / Math.max(dt, 1e-3)
  let crashDelta = 0
  let shake      = 0
  if (allowDrive && s.prevSpeed > crashMinSpeed && decel > crashDecel && s.crashCooldown <= 0) {
    crashDelta = 1
    shake = Math.min(1.2, decel / 110)
    s.crashCooldown = 0.8
  }
  s.crashCooldown = Math.max(0, s.crashCooldown - dt)
  s.prevSpeed     = currentSpeed

  return {
    speed:      currentSpeed,
    boostMeter: nextBoostMeter,
    grounded,
    boosting,
    engineForce,
    contacts,
    crashDelta,
    shake,
    respawned,
  }
}
