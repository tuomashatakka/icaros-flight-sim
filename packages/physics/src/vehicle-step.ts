import { MathUtils, Quaternion, Vector3 } from 'three'
import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import { vehicleConfig } from './config'
import type { ShipTuning, Transform } from './types'
import {
  AIRBRAKE_PANELS,
  DOWNFORCE,
  DRAG,
  INERTIA,
  LATERAL_L,
  LATERAL_R,
  MAIN_L,
  MAIN_R,
  RCS_L,
  RCS_R,
  RETRO_L,
  RETRO_R,
  THRUSTER_RIG,
} from './thrusters'
import type { ForceSample } from './thrusters'

/** Module-scope scratch — mutated each step, never reallocated. */
const WORLD_UP    = new Vector3(0, 1, 0)
const _fwd        = new Vector3()
const _up         = new Vector3()
const _right      = new Vector3()
const _surfNormal = new Vector3()
const _targetUp   = new Vector3()
const _axis       = new Vector3()
const _omega      = new Vector3()
const _tmp        = new Vector3()
const _tmp2       = new Vector3()
const _point      = new Vector3()
const _force      = new Vector3()
const _torque     = new Vector3()
const _netForce   = new Vector3()
const _netTorque  = new Vector3()
const _tmpQuat    = new Quaternion()

/** Reused ray — one cast per hover pad per tick, four ships deep on the server. */
let _ray: RAPIER.Ray | null = null

const throttles   = new Float64Array(THRUSTER_RIG.length)
const padDistance = new Float64Array(4)
const padHit      = new Uint8Array(4)

const AIR_DENSITY = 1.225

/**
 * Where the hull settles as a fraction of `hoverHeight` under its own weight.
 * The spring constant is solved backwards from this, so "ride height" means the
 * height it actually rides at rather than the height it would reach unloaded.
 */
const HOVER_REST_RATIO = 0.35

/**
 * Hover rays must ignore sensors.
 *
 * Checkpoint gates are sensor cuboids eight metres tall sitting on the racing
 * line, and rapier includes sensors in ray casts by default. Without this flag
 * the hover pads found "ground" at the top of every gate and fired at full
 * force, launching the ship two and a half metres into the air each time it
 * crossed one — which read as a mystery bounce on a dead-flat plane, and cost
 * three phantom crash events per lap.
 */
const HOVER_FILTER = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS

/**
 * Forward speed at which station keeping asks for full thrust one way.
 *
 * Tight on purpose. Proportional control against a steady disturbance always
 * leaves a standing error, so a wide band on a slope becomes a slow permanent
 * creep downhill — 93 m of it over twelve seconds, at a speed low enough that a
 * naive "is it holding?" check still passed.
 */
const STATION_TRIM = 0.4

/** Reverse is a parking manoeuvre, not a driving mode. Metres per second. */
const REVERSE_SPEED = 12

/** Emergency clamp. Drag sets top speed now; this only catches solver blowups. */
const RUNAWAY_SPEED = vehicleConfig.maxSpeed * 4

/**
 * Per-ship smoothed state that must survive between ticks.
 *
 * Constructor-initialised on purpose — battle's replay harness builds a fresh
 * sim per run precisely so nobody has to remember to reset this.
 */
export type HovercraftState = {
  smoothedYawRate: number;
  prevSpeed:       number;
  crashCooldown:   number;

  /** Air-brake deployment 0..1. Eased, and read by the wing animation. */
  airbrake: number;
}

export function createHovercraftState (): HovercraftState {
  return { smoothedYawRate: 0, prevSpeed: 0, crashCooldown: 0, airbrake: 0 }
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

  /** Air-brake deployment 0..1, for the wing panels. */
  airbrake: number;

  /** How many crash events fired this step (0 or 1). */
  crashDelta: number;
  shake:      number;
  respawned:  boolean;

  /**
   * Every force applied this tick, in WORLD space, when `collectForces` is set.
   * The array is reused between steps — copy it if you need to keep it.
   */
  forces:    readonly ForceSample[];
  netForce:  readonly [number, number, number];
  netTorque: readonly [number, number, number];
}

export type HovercraftStepParams = {
  chassis: RAPIER.RigidBody;
  world:   RAPIER.World;
  input:   HovercraftInput;
  tuning:  ShipTuning;
  state:   HovercraftState;
  dt:      number;

  /** Whether driving input is live ("GO"). Zeroes thrust/steer when false. */
  allowDrive: boolean;

  /** Where the ship teleports on reset / fall-through. */
  spawn: Transform;

  /** A teleport/respawn was requested this tick (edge-triggered upstream). */
  resetRequested: boolean;

  /** Current boost reserve 0..1, in and out. */
  boostMeter: number;

  // The speed the main engines push toward. The race scene drives this from
  //  zone escalation; battle just passes the hull max.
  targetSpeed: number;

  /** Dev only: fill `result.forces` for the overlay. Costs allocation. */
  collectForces?: boolean;

  /**
   * World-space force from outside the ship — wind, a turbine wash, a blast.
   *
   * Applied at the COM and recorded as a `'wind'` sample, so it shows up in the
   * debug arrows like everything else. A force the overlay cannot see is a force
   * that defeats the point of having the overlay. Must be a pure function of
   * tick and pose upstream, or determinism goes with it.
   */
  externalForce?: readonly [number, number, number];
}

export type HovercraftRig = {
  chassis: RAPIER.RigidBody;
}

const samples: ForceSample[] = []
let sampleCount = 0

function sample (
  id: string,
  group: ForceSample['group'],
  point: Vector3,
  vector: Vector3
) {
  const existing = samples[sampleCount]
  if (existing) {
    existing.id        = id
    existing.group     = group
    existing.point[0]  = point.x
    existing.point[1]  = point.y
    existing.point[2]  = point.z
    existing.vector[0] = vector.x
    existing.vector[1] = vector.y
    existing.vector[2] = vector.z
  }
  else
    samples.push({
      id,
      group,
      point:  [ point.x, point.y, point.z ],
      vector: [ vector.x, vector.y, vector.z ],
    })
  sampleCount++
}

/**
 * Build one hovercraft body, configured identically for the race scene and the
 * headless battle server.
 *
 * There is no vehicle controller any more. The ship used to be a rapier
 * `DynamicRayCastVehicleController` with four invisible wheels, which meant
 * thrust only bit while a wheel touched ground, and it kept per-wheel suspension
 * state rapier does not expose — the reason battle prediction had to correct in
 * tiers rather than snapshot cleanly. Everything the wheels did is now four
 * hover thrusters in `THRUSTER_RIG`, whose entire state is the body pose.
 */
export function createHovercraft (
  world: RAPIER.World,
  at: Transform = { position: [ 1, 2, 4 ], quaternion: [ 0, 1, 0, 0 ]}
): HovercraftRig {
  const { width, height, front } = vehicleConfig
  const { position, quaternion } = at

  const chassis = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(position[0], position[1], position[2])
      .setRotation({
        x: quaternion[0],
        y: quaternion[1],
        z: quaternion[2],
        w: quaternion[3],
      })
      // Damping stays low: drag is modelled explicitly and anisotropically in
      // `DRAG`, so a big isotropic damping term here would just fight it.
      .setLinearDamping(0.02)
      .setAngularDamping(0.35)
      .setCcdEnabled(true)
      .setCanSleep(false)
  )
  chassis.userData = { isVehicle: true }

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(width / 2, height / 2, front).setMass(vehicleConfig.mass),
    chassis
  )

  return { chassis }
}

/**
 * Step one hovercraft for one fixed 1/60 s tick.
 *
 * Sense -> control -> allocate -> apply. The only pose mutation is a teleport;
 * everything else the ship does this tick is `addForceAtPoint` and rapier
 * integrating the result. Nothing sets a velocity to make the ship move.
 *
 * The control block is a flight-control system, not a fake: it decides how hard
 * each nozzle fires, and that is the only decision it makes. Where the ship ends
 * up is `tau = r x F` against the real inertia tensor, which is why strafing
 * yaws you, why a pad over a bump pitches you, and why none of that needed a
 * special case.
 */
export function stepHovercraft (params: HovercraftStepParams): HovercraftStepResult {
  const {
    chassis,
    world,
    input,
    tuning: t,
    state: s,
    dt,
    allowDrive,
    spawn,
    resetRequested,
    boostMeter,
    targetSpeed: baseTarget,
    collectForces = false,
    externalForce,
  } = params
  const {
    mass,
    maxSpeed,
    strafeSpeedScale,
    yawResponse,
    highSpeedYawScale,
    airYawRate,
    airLevelStrength,
    maxTiltRate,
    suspensionTravel,
    suspensionCompression,
    boostThrustMultiplier,
    boostSpeedMultiplier,
    boostYawMultiplier,
    boostDrainRate,
    boostRechargeRate,
    crashDecel,
    crashMinSpeed,
  } = vehicleConfig

  sampleCount = 0
  _netForce.set(0, 0, 0)
  _netTorque.set(0, 0, 0)
  throttles.fill(0)

  if (!_ray)
    _ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })

  const ray = _ray

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
    s.airbrake        = 0
  }

  let respawned = false
  if (resetRequested || chassis.translation().y < -40) {
    teleport()
    respawned = true
  }

  chassis.resetForces(true)
  chassis.resetTorques(true)

  // --- Body frame -------------------------------------------------------
  const pos = chassis.translation()
  const rot = chassis.rotation()
  _tmpQuat.set(rot.x, rot.y, rot.z, rot.w)
  _fwd.set(0, 0, 1).applyQuaternion(_tmpQuat)
  _up.set(0, 1, 0).applyQuaternion(_tmpQuat)
  _right.set(1, 0, 0).applyQuaternion(_tmpQuat)

  const lv           = chassis.linvel()
  const av           = chassis.angvel()
  const currentSpeed = Math.hypot(lv.x, lv.y, lv.z)
  _omega.set(av.x, av.y, av.z)

  // Velocity in body axes — drag and the speed governor both want it split.
  const vFwd   = lv.x * _fwd.x + lv.y * _fwd.y + lv.z * _fwd.z
  const vRight = lv.x * _right.x + lv.y * _right.y + lv.z * _right.z
  const vUp    = lv.x * _up.x + lv.y * _up.y + lv.z * _up.z

  // --- Boost ------------------------------------------------------------
  const boosting       = allowDrive && input.boost && boostMeter > 0
  const nextBoostMeter = Math.max(
    0,
    Math.min(1, boostMeter + (boosting ? -boostDrainRate : boostRechargeRate) * dt)
  )
  const targetSpeed = boosting ? baseTarget * boostSpeedMultiplier : baseTarget
  const speedRatio  = Math.min(currentSpeed / Math.max(targetSpeed, 1), 1)

  // --- SENSE: four hover rays -------------------------------------------
  // Cast along body-down from each pad. The ship's own collider is excluded by
  // rigid body, not by collider handle, so this keeps working if the hull ever
  // grows a second collider.
  const restLength = t.hoverHeight
  const maxToi     = restLength + suspensionTravel
  _surfNormal.set(0, 0, 0)

  let contacts = 0
  for (let i = 0; i < 4; i++) {
    const th = THRUSTER_RIG[LIFT_INDEX[i]]
    _point.set(th.pos[0], th.pos[1], th.pos[2]).applyQuaternion(_tmpQuat)
    ray.origin.x = pos.x + _point.x
    ray.origin.y = pos.y + _point.y
    ray.origin.z = pos.z + _point.z
    ray.dir.x    = -_up.x
    ray.dir.y    = -_up.y
    ray.dir.z    = -_up.z

    const hit = world.castRayAndGetNormal(ray, maxToi, true, HOVER_FILTER, undefined, undefined, chassis)
    if (hit) {
      padHit[i]      = 1
      padDistance[i] = hit.timeOfImpact
      _surfNormal.add(_tmp.set(hit.normal.x, hit.normal.y, hit.normal.z))
      contacts++
    }
    else {
      padHit[i]      = 0
      padDistance[i] = maxToi
    }
  }

  const grounded = contacts > 0
  if (grounded)
    _surfNormal.normalize()
  else
    _surfNormal.copy(WORLD_UP)

  // --- CONTROL: altitude -------------------------------------------------
  // Solved backwards from where the hull should sit: four springs carrying
  // `mass * g` at `HOVER_REST_RATIO` compression. Tuning scales it, so the debug
  // panel still means "firmer float" without anyone re-deriving a magic number.
  const weight    = mass * 9.81
  const stiffness = weight / (4 * Math.max(restLength, 0.05) * HOVER_REST_RATIO) *
    (t.suspensionStiffness / vehicleConfig.suspensionStiffness)
  // Slightly OVERdamped, so a hard landing settles in one motion instead of
  // trading the impact back and forth with the spring for a second.
  const damping = 2 * 1.2 * Math.sqrt(stiffness * mass / 4) *
    (suspensionCompression / vehicleConfig.suspensionCompression)

  const padLift = [ 0, 0, 0, 0 ]
  for (let i = 0; i < 4; i++) {
    if (!padHit[i])
      continue

    const th = THRUSTER_RIG[LIFT_INDEX[i]]
    // Vertical speed AT THE PAD, not at the COM: v = v_com + omega x r. Using the
    // COM value lets a pitching hull compress one pad without the damper ever
    // noticing, which is exactly when you want the damper.
    _tmp.set(th.pos[0], th.pos[1], th.pos[2]).applyQuaternion(_tmpQuat)
    _tmp2.crossVectors(_omega, _tmp)

    const padVup = vUp + (_tmp2.x * _up.x + _tmp2.y * _up.y + _tmp2.z * _up.z)

    padLift[i] = Math.max(0, stiffness * (restLength - padDistance[i]) - damping * padVup)
  }

  // --- CONTROL: attitude -------------------------------------------------
  // Align ship-up with the surface (world-up in the air). PD, not the old
  // `setAngvel`: the correction has to be a torque or the hull cannot be pushed
  // around by anything else, which is what made every other force decorative.
  _targetUp.copy(grounded ? _surfNormal : WORLD_UP)
  _axis.crossVectors(_up, _targetUp)

  const sinA      = _axis.length()
  const cosA      = Math.max(-1, Math.min(1, _up.dot(_targetUp)))
  const tiltAngle = Math.atan2(sinA, cosA)
  if (sinA > 1e-5)
    _axis.multiplyScalar(1 / sinA)
  else
    _axis.set(0, 0, 0)

  // Only the component of spin that is NOT yaw gets damped — damping the yaw
  // axis here would fight the steering loop below for the same authority.
  const yawRateNow = _omega.dot(_up)
  _tmp.copy(_omega).addScaledVector(_up, -yawRateNow)

  const tiltGain = grounded ? t.uprightStrength : airLevelStrength
  const tiltRate = Math.max(-maxTiltRate, Math.min(maxTiltRate, tiltAngle * tiltGain))
  _torque.copy(_axis).multiplyScalar(tiltRate)
    .sub(_tmp)
    .multiplyScalar(INERTIA.pitch * 6)

  // Split into the pitch/roll components the pads can actually produce.
  const torquePitch = _torque.dot(_right)
  const torqueRoll  = _torque.dot(_fwd)

  if (grounded)
    for (let i = 0; i < 4; i++) {
      if (!padHit[i])
        continue

      const th = THRUSTER_RIG[LIFT_INDEX[i]]
      padLift[i] += -torquePitch * th.pos[2] / SUM_Z2 + torqueRoll * th.pos[0] / SUM_X2
      padLift[i] = Math.max(0, Math.min(th.maxForce, padLift[i]))
    }
  else if (allowDrive || tiltAngle > 0.05) {
    // Airborne there is no lift to differentiate, so the attitude jets fire as a
    // pure couple. Same PD, same gains, different hardware.
    chassis.addTorque({ x: _torque.x, y: _torque.y, z: _torque.z }, true)
    _netTorque.add(_torque)
    if (collectForces) {
      _point.set(pos.x, pos.y, pos.z)
      sample('attitude', 'attitude', _point, _torque)
    }
  }

  for (let i = 0; i < 4; i++)
    throttles[LIFT_INDEX[i]] = padLift[i] / THRUSTER_RIG[LIFT_INDEX[i]].maxForce

  // --- CONTROL: yaw ------------------------------------------------------
  // NEGATED here on purpose, and this is the only place the sign lives: a
  // positive rotation about +Y is counter-clockwise seen from above, i.e. a LEFT
  // turn, so without this "steer right" turns the ship left.
  const steerInput    = allowDrive ? -input.steer : 0
  const yawSpeedScale = MathUtils.lerp(1, highSpeedYawScale, speedRatio)
  const boostYawMul   = input.boost ? boostYawMultiplier : 1
  const desiredYaw    = grounded
    ? steerInput * t.maxYawRate * yawSpeedScale * boostYawMul
    : steerInput * airYawRate
  const yawLerp     = 1 - Math.exp(-yawResponse * dt)
  s.smoothedYawRate = MathUtils.lerp(s.smoothedYawRate, allowDrive ? desiredYaw : 0, yawLerp)

  // Torque the jets must produce to close the rate error this tick.
  const yawTorque = (s.smoothedYawRate - yawRateNow) * INERTIA.yaw * 5
  const rcsArm    = Math.abs(THRUSTER_RIG[RCS_R].pos[2])
  const rcsForce  = Math.abs(yawTorque) / Math.max(rcsArm, 1e-3)
  // rcs.R sits to port pushing +X at the tail, so it yaws the ship right, which
  // is a NEGATIVE torque about +Y.
  if (yawTorque < 0)
    throttles[RCS_R] = Math.min(1, rcsForce / THRUSTER_RIG[RCS_R].maxForce)
  else if (yawTorque > 0)
    throttles[RCS_L] = Math.min(1, rcsForce / THRUSTER_RIG[RCS_L].maxForce)

  // --- CONTROL: translation ----------------------------------------------
  // Holding BOTH throttle and brake is station keeping, not a contradiction:
  // mains lit, air brakes out, and the difference trimmed to hold position. It
  // is how you park an airframe that has no wheels to sit on. This used to be
  // unexpressible — `throttleOpen` was false whenever braking, so the brake
  // simply won and the mains never fired at all.
  const holding      = allowDrive && input.throttle && input.brake
  const isReversing  = allowDrive && !holding && Boolean(input.reverse || input.brake && currentSpeed < 5)
  const isBraking    = allowDrive && !holding && input.brake && !isReversing
  const throttleOpen = allowDrive && !isBraking && !isReversing && (input.throttle || boosting)

  // Ease off over the last 12% rather than cutting hard at the limit: a hard cut
  // makes the ship visibly hunt around the zone speed.
  const governor = Math.max(0, Math.min(1, (targetSpeed - vFwd) / (targetSpeed * 0.12)))
  let mainLevel  = throttleOpen ? governor * (boosting ? boostThrustMultiplier : 1) : 0

  // Braking OPPOSES travel; it does not just fire the retros. Below ~5 m/s
  // `isReversing` takes over, and once the ship was going backwards faster than
  // that it flipped back to "braking" — which fired the retros, which is the
  // direction it was already accelerating. Holding brake from a standstill sent
  // the ship off the back of the deck at 22 m/s.
  if (isBraking && vFwd < -0.5)
    mainLevel = Math.max(mainLevel, Math.min(1, -vFwd / 6))

  // Station keeping: drive forward speed to zero and hold it there. Whichever
  // way the ship is drifting, the opposing bank trims it out — so the mains and
  // the retros both see duty and the hull sits still with its engines lit.
  let holdRetro = 0
  if (holding) {
    const error = -vFwd / STATION_TRIM
    mainLevel   = Math.max(0, Math.min(1, error))
    holdRetro   = Math.max(0, Math.min(1, -error))
  }

  throttles[MAIN_L] = Math.min(1, mainLevel)
  throttles[MAIN_R] = Math.min(1, mainLevel)

  // Reverse gets its own governor. Braking is unlimited — you want all of it —
  // but reverse thrust with nothing but drag to stop it settles around 30 m/s
  // backwards, which is faster than most people drive forwards.
  const reverseGov   = Math.max(0, Math.min(1, (REVERSE_SPEED + vFwd) / (REVERSE_SPEED * 0.3)))
  const retroLevel   = holding ? holdRetro : isBraking && vFwd > -0.5 ? 1 : isReversing ? 0.6 * reverseGov : 0
  throttles[RETRO_L] = retroLevel
  throttles[RETRO_R] = retroLevel

  // Strafe. Deliberately uncompensated — the yaw, roll and nose-dip it induces
  // are the point, not artefacts to cancel. See the placement note in
  // `thrusters.ts`; `strafe > 0` is rightward, which is `lateral.R`.
  const strafeVal = allowDrive && input.strafe ? Math.max(-1, Math.min(1, input.strafe)) : 0
  if (strafeVal > 0)
    throttles[LATERAL_R] = strafeVal * strafeSpeedScale / 0.14
  else if (strafeVal < 0)
    throttles[LATERAL_L] = -strafeVal * strafeSpeedScale / 0.14

  // --- APPLY: thrusters ---------------------------------------------------
  // Fixed rig order, so the float accumulation is bit-identical run to run.
  let mainForceOut = 0
  for (let i = 0; i < THRUSTER_RIG.length; i++) {
    const level = throttles[i]
    if (level <= 1e-4)
      continue

    const th = THRUSTER_RIG[i]
    const f  = Math.min(1, level) * th.maxForce

    _point.set(th.pos[0], th.pos[1], th.pos[2]).applyQuaternion(_tmpQuat)
    _point.x += pos.x
    _point.y += pos.y
    _point.z += pos.z

    _force.set(th.dir[0], th.dir[1], th.dir[2]).applyQuaternion(_tmpQuat)
      .multiplyScalar(f)

    chassis.addForceAtPoint(
      { x: _force.x, y: _force.y, z: _force.z },
      { x: _point.x, y: _point.y, z: _point.z },
      true
    )
    _netForce.add(_force)
    if (th.group === 'main')
      mainForceOut += f
    if (collectForces)
      sample(th.id, th.group, _point, _force)
  }

  // --- APPLY: body drag ---------------------------------------------------
  // Anisotropic, in body axes. The lateral term is the hovercraft's grip: it is
  // what keeps a turn from becoming a slide, and it replaces the wheel side
  // friction the raycast controller used to supply.
  const lateralDrag = DRAG.lat * (t.sideGrip / vehicleConfig.sideGrip)
  _force.set(0, 0, 0)
    .addScaledVector(_fwd, -DRAG.long * vFwd * Math.abs(vFwd))
    .addScaledVector(_right, -lateralDrag * vRight * Math.abs(vRight))
    .addScaledVector(_up, -DRAG.vert * vUp * Math.abs(vUp))
  // Downforce rides along with drag: same aerodynamic surface, same v^2 law, and
  // it is the only thing that can put the ship back on the track once the hover
  // pads have run out of reach. At the COM, so it plants the hull without
  // pitching it.
  _force.addScaledVector(_up, -DOWNFORCE * currentSpeed * currentSpeed)

  chassis.addForce({ x: _force.x, y: _force.y, z: _force.z }, true)
  _netForce.add(_force)
  if (collectForces) {
    _point.set(pos.x, pos.y, pos.z)
    sample('drag', 'drag', _point, _force)
  }

  // --- APPLY: air brakes --------------------------------------------------
  // Wing panels. Eased so the drag ramps with the animation the player sees, and
  // applied at the panels rather than the COM, so a one-sided deploy would yaw.
  const brakeTarget = isBraking || holding ? 1 : 0
  s.airbrake += (brakeTarget - s.airbrake) * Math.min(1, dt * 5)
  if (s.airbrake > 0.01 && currentSpeed > 0.5) {
    _tmp.set(lv.x, lv.y, lv.z).normalize()
    for (const panel of AIRBRAKE_PANELS) {
      const magnitude = 0.5 * AIR_DENSITY * panel.dragArea * currentSpeed * currentSpeed * s.airbrake
      _force.copy(_tmp).multiplyScalar(-magnitude)
      _point.set(panel.pos[0], panel.pos[1], panel.pos[2]).applyQuaternion(_tmpQuat)
      _point.x += pos.x
      _point.y += pos.y
      _point.z += pos.z
      chassis.addForceAtPoint(
        { x: _force.x, y: _force.y, z: _force.z },
        { x: _point.x, y: _point.y, z: _point.z },
        true
      )
      _netForce.add(_force)
      if (collectForces)
        sample(panel.id, 'airbrake', _point, _force)
    }
  }

  // --- APPLY: external force ----------------------------------------------
  if (externalForce) {
    _force.set(externalForce[0], externalForce[1], externalForce[2])
    if (_force.lengthSq() > 1e-8) {
      chassis.addForce({ x: _force.x, y: _force.y, z: _force.z }, true)
      _netForce.add(_force)
      if (collectForces) {
        _point.set(pos.x, pos.y, pos.z)
        sample('wind', 'wind', _point, _force)
      }
    }
  }

  // Safety net: never let a solver glitch fling the body across the level. Drag
  // is what sets top speed now, so this should never fire in normal play.
  if (currentSpeed > RUNAWAY_SPEED) {
    const scale = RUNAWAY_SPEED / currentSpeed
    chassis.setLinvel({ x: lv.x * scale, y: lv.y * scale, z: lv.z * scale }, true)
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
    speed:       currentSpeed,
    boostMeter:  nextBoostMeter,
    grounded,
    boosting,
    engineForce: mainForceOut,
    contacts,
    airbrake:    s.airbrake,
    crashDelta,
    shake,
    respawned,
    forces:      collectForces ? samples.slice(0, sampleCount) : EMPTY_FORCES,
    netForce:    [ _netForce.x, _netForce.y, _netForce.z ],
    netTorque:   [ _netTorque.x, _netTorque.y, _netTorque.z ],
  }
}

const EMPTY_FORCES: readonly ForceSample[] = []

/** Rig indices of the four hover pads, and the arm sums the pad split needs. */
const LIFT_INDEX = THRUSTER_RIG.reduce<number[]>((acc, th, i) => {
  if (th.group === 'lift')
    acc.push(i)
  return acc
}, [])

const SUM_Z2 = LIFT_INDEX.reduce((a, i) => a + THRUSTER_RIG[i].pos[2] ** 2, 0)
const SUM_X2 = LIFT_INDEX.reduce((a, i) => a + THRUSTER_RIG[i].pos[0] ** 2, 0)
