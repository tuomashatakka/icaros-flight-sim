import { MathUtils, Quaternion, Vector3 } from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { defineModule, type AppModule } from 'threejs-scene';
import { vehicleConfig } from '@/lib/utils';
import { useRaceStore, type Transform } from '@/hooks/use-race-store';
import type { RaceState } from '../state';
import type { Physics } from '../physics/world';
import { BodyInterpolator } from '../interpolation';
import type { Telemetry } from '../telemetry';

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
function computeBankAngle(steerNorm: number, speedRatio: number, maxBank: number): number {
  return steerNorm * maxBank * speedRatio;
}

// Module-scope scratch — mutated each step, never reallocated.
const WORLD_UP = new Vector3(0, 1, 0);
const _fwd = new Vector3();
const _up = new Vector3();
const _surfNormal = new Vector3();
const _targetUp = new Vector3();
const _axis = new Vector3();
const _tiltOmega = new Vector3();
const _yawOmega = new Vector3();
const _targetAngvel = new Vector3();
const _tmp = new Vector3();
const _tmpQuat = new Quaternion();
const _bankQuat = new Quaternion();

export type VehicleDebug = {
  racing: boolean;
  engineForce: number;
  currentSpeed: number;
  targetSpeed: number;
  contacts: number;
  dt: number;
};

export type VehicleHandle = {
  readonly body: RAPIER.RigidBody | null;
  readonly interpolator: BodyInterpolator | null;
  readonly controller: RAPIER.DynamicRayCastVehicleController | null;
  readonly debug: VehicleDebug | null;
  /** Cut the ship to a transform. Suppresses interpolation across the jump. */
  teleportTo(transform: Transform, liftY?: number): void;
};

/**
 * The hovercraft.
 *
 * A rapier raycast-vehicle controller repurposed as a hover + grip engine:
 * long suspension rest length is the float height, wheel ray contacts are
 * ground-follow, and side friction is the carve that resists sliding out of a
 * turn. Steering is a SINGLE driven yaw about the ship's own up, and
 * orientation aligns ship-up to the averaged surface normal, so the ship banks
 * into banked corners and self-rights on flat ground.
 *
 * Ported from the R3F `useBeforePhysicsStep` body with the logic unchanged —
 * only how it obtains `dt`, state and input differs.
 */
export function vehicleModule(
  physics: Physics,
  telemetry: Telemetry,
  handle: { current: VehicleHandle | null },
  onSnap: () => void
): AppModule<RaceState> {
  const { RAPIER, world } = physics;
  const { width, height, front, back, wheelRadius } = vehicleConfig;

  let chassis: RAPIER.RigidBody | null = null;
  let controller: RAPIER.DynamicRayCastVehicleController | null = null;
  let interpolator: BodyInterpolator | null = null;

  let smoothedYawRate = 0;
  let prevSpeed = 0;
  let crashCooldown = 0;
  let lastResetSeq = 0;
  let lastStatus: RaceState['status'] = 'idle';
  let lastDebug: VehicleDebug | null = null;

  function teleportTo(transform: Transform, liftY = 1) {
    if (!chassis) return;
    const { position, quaternion } = transform;
    chassis.setTranslation({ x: position[0], y: position[1] + liftY, z: position[2] }, true);
    chassis.setRotation(
      { x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3] },
      true
    );
    chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
    chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
    smoothedYawRate = 0;
    telemetry.shake = 0;
    interpolator?.teleport();
    onSnap();
  }

  const respawn = () => teleportTo(useRaceStore.getState().respawn);

  return defineModule<RaceState>({
    name: 'vehicle',

    build() {
      chassis = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(1, 2, 4)
          .setRotation({ x: 0, y: 1, z: 0, w: 0 }) // yaw PI
          .setLinearDamping(0.1)
          .setAngularDamping(0.5)
          .setCcdEnabled(true)
          .setCanSleep(false)
      );
      chassis.userData = { isVehicle: true };

      world.createCollider(
        RAPIER.ColliderDesc.cuboid(width / 2, height / 2, front).setMass(vehicleConfig.mass),
        chassis
      );

      // Wheel chassis-connection points, local space:
      // [front-left, front-right, back-left, back-right].
      const wheels = [
        { x: -width / 2, y: -height / 2, z: front },
        { x: width / 2, y: -height / 2, z: front },
        { x: -width / 2, y: -height / 2, z: back },
        { x: width / 2, y: -height / 2, z: back },
      ];

      // The wheels are invisible hover pads: pure suspension + grip, no steering
      // and no per-wheel braking (turning is a single yaw source, applied below).
      controller = world.createVehicleController(chassis);
      controller.indexUpAxis = 1;
      controller.setIndexForwardAxis = 2;

      const down = { x: 0, y: -1, z: 0 };
      const axle = { x: -1, y: 0, z: 0 };
      for (const pos of wheels) {
        controller.addWheel(pos, down, axle, vehicleConfig.hoverHeight, wheelRadius);
      }
      for (let i = 0; i < wheels.length; i++) {
        controller.setWheelSuspensionStiffness(i, vehicleConfig.suspensionStiffness);
        controller.setWheelMaxSuspensionTravel(i, vehicleConfig.suspensionTravel);
        controller.setWheelSuspensionCompression(i, vehicleConfig.suspensionCompression);
        controller.setWheelSuspensionRelaxation(i, vehicleConfig.suspensionRelaxation);
        controller.setWheelMaxSuspensionForce(i, 100000);
        controller.setWheelFrictionSlip(i, vehicleConfig.forwardGrip);
        controller.setWheelSideFrictionStiffness(i, vehicleConfig.sideGrip);
      }

      interpolator = new BodyInterpolator(chassis);
      physics.interpolators.push(interpolator);

      handle.current = {
        get body() {
          return chassis;
        },
        get interpolator() {
          return interpolator;
        },
        get controller() {
          return controller;
        },
        get debug() {
          return lastDebug;
        },
        teleportTo,
      };
    },

    update(state, frame) {
      if (!controller || !chassis) return;

      const dt = frame.delta;
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
      } = vehicleConfig;
      const t = state.tuning;

      const racing = state.status === 'racing';

      // Snap to the start line whenever a countdown begins (initial race +
      // "Race again"). Edge-triggered on the status transition.
      if (state.status === 'countdown' && lastStatus !== 'countdown') {
        teleportTo(useRaceStore.getState().spawn);
        telemetry.boostMeter = 1;
      }
      lastStatus = state.status;

      const lv = chassis.linvel();
      const currentSpeed = Math.hypot(lv.x, lv.y, lv.z);

      // Counter, not a boolean: the sim runs several ticks per real frame, so a
      // held key read as a level would respawn on every one of them.
      if (state.resetSeq !== lastResetSeq) {
        lastResetSeq = state.resetSeq;
        respawn();
      }

      // Boost reserve: drains while held (and available), recharges otherwise.
      const boosting = racing && state.boost && telemetry.boostMeter > 0;
      telemetry.boosting = boosting;
      telemetry.boostMeter = Math.max(
        0,
        Math.min(1, telemetry.boostMeter + (boosting ? -boostDrainRate : boostRechargeRate) * dt)
      );

      const baseTarget = Math.min(state.targetSpeed, maxSpeed);
      const targetSpeed = boosting ? baseTarget * boostSpeedMultiplier : baseTarget;
      const speedRatio = Math.min(currentSpeed / Math.max(targetSpeed, 1), 1);

      // Apply live hover/grip tuning so the debug panel updates the float in real time.
      for (let i = 0; i < 4; i++) {
        controller.setWheelSuspensionRestLength(i, t.hoverHeight);
        controller.setWheelSuspensionStiffness(i, t.suspensionStiffness);
        controller.setWheelSideFrictionStiffness(i, t.sideGrip);
      }

      // Thrust: all-wheel engine force, gated on the throttle being HELD (the
      // ship does not accelerate on its own), on "GO", and capped at target
      // speed. Engine force only bites while wheels touch ground, so it
      // self-cuts in the air.
      const driveForce = boosting ? t.thrust * boostThrustMultiplier : t.thrust;
      const throttleOpen = state.throttle || boosting;
      const engineForce = racing && throttleOpen && currentSpeed < targetSpeed ? driveForce : 0;
      for (let i = 0; i < 4; i++) {
        controller.setWheelEngineForce(i, engineForce);
        controller.setWheelSteering(i, 0);
        controller.setWheelBrake(i, 0);
      }

      // Step the suspension + friction solver. After this, wheel contacts are valid.
      controller.updateVehicle(dt);
      telemetry.speed = currentSpeed;

      // --- Surface-aware orientation ----------------------------------------
      // Average the wheel contact normals to get the track surface under the ship.
      _surfNormal.set(0, 0, 0);
      let contacts = 0;
      for (let i = 0; i < 4; i++) {
        if (controller.wheelIsInContact(i)) {
          const n = controller.wheelContactNormal(i);
          if (n) {
            _surfNormal.add(_tmp.set(n.x, n.y, n.z));
            contacts++;
          }
        }
      }
      const grounded = contacts > 0;
      telemetry.grounded = grounded;
      lastDebug = { racing, engineForce, currentSpeed, targetSpeed, contacts, dt };
      if (grounded) _surfNormal.normalize();
      else _surfNormal.copy(WORLD_UP);

      // Current orientation basis.
      const rNow = chassis.rotation();
      _tmpQuat.set(rNow.x, rNow.y, rNow.z, rNow.w);
      _fwd.set(0, 0, 1).applyQuaternion(_tmpQuat);
      _up.set(0, 1, 0).applyQuaternion(_tmpQuat);

      // Eased single yaw source. steer in [-1, 1], positive = right.
      //
      // NEGATED here on purpose, and this is the only place the sign lives: yaw
      // is driven about the ship's own UP axis, and a positive rotation about +Y
      // is counter-clockwise seen from above — i.e. a LEFT turn. Without the
      // negation, "steer right" turns the ship left. Fixing it here rather than
      // in the input layer keeps one convention for keyboard, drag and any
      // future gamepad.
      const steerInput = racing ? -state.steer : 0;
      const yawSpeedScale = MathUtils.lerp(1, highSpeedYawScale, speedRatio);
      const boostYawMul = state.boost ? boostYawMultiplier : 1;
      const desiredYaw = grounded
        ? steerInput * t.maxYawRate * yawSpeedScale * boostYawMul
        : steerInput * airYawRate;
      const yawLerp = 1 - Math.exp(-yawResponse * dt);
      smoothedYawRate = MathUtils.lerp(smoothedYawRate, racing ? desiredYaw : 0, yawLerp);
      const yawRate = smoothedYawRate;

      // Cosmetic bank: lean the target-up into the turn (FEEL KNOB above).
      const steerNorm = Math.max(-1, Math.min(1, yawRate / Math.max(t.maxYawRate, 1e-3)));
      const bankAngle = grounded ? computeBankAngle(steerNorm, speedRatio, t.maxBank) : 0;
      _bankQuat.setFromAxisAngle(_fwd, -bankAngle);
      _targetUp.copy(_surfNormal).applyQuaternion(_bankQuat).normalize();

      // Tilt correction: angular velocity that rotates ship-up toward target-up.
      // The cross product gives the (pitch/roll) axis; it never contains a yaw
      // component, so driven yaw stays clean. Strength is a P-gain.
      _axis.crossVectors(_up, _targetUp);
      const sinA = _axis.length();
      const cosA = Math.max(-1, Math.min(1, _up.dot(_targetUp)));
      const tiltAngle = Math.atan2(sinA, cosA);
      if (sinA > 1e-5) _axis.multiplyScalar(1 / sinA);
      else _axis.set(0, 0, 0);
      const tiltStrength = grounded ? t.uprightStrength : airLevelStrength;
      _tiltOmega.copy(_axis).multiplyScalar(tiltAngle * tiltStrength);
      if (_tiltOmega.length() > maxTiltRate) _tiltOmega.setLength(maxTiltRate);

      // Driven yaw about the ship's own up (so turns stay in the track plane when banked).
      _yawOmega.copy(_up).multiplyScalar(yawRate);

      // Final target angular velocity = driven yaw + surface-alignment tilt.
      _targetAngvel.copy(_yawOmega).add(_tiltOmega);
      chassis.setAngvel({ x: _targetAngvel.x, y: _targetAngvel.y, z: _targetAngvel.z }, true);

      // Safety net: never let a solver glitch fling the body past a sane speed.
      const lvNow = chassis.linvel();
      const spNow = Math.hypot(lvNow.x, lvNow.y, lvNow.z);
      const speedCap = maxSpeed * boostSpeedMultiplier * 1.4;
      if (spNow > speedCap) {
        const s = speedCap / spNow;
        chassis.setLinvel({ x: lvNow.x * s, y: lvNow.y * s, z: lvNow.z * s }, true);
      }

      // A sharp drop in speed from a fast-enough run reads as an impact.
      const decel = (prevSpeed - currentSpeed) / Math.max(dt, 1e-3);
      if (racing && prevSpeed > crashMinSpeed && decel > crashDecel && crashCooldown <= 0) {
        telemetry.crashSeq++;
        telemetry.shake = Math.min(1.2, decel / 110);
        crashCooldown = 0.8;
      }
      crashCooldown = Math.max(0, crashCooldown - dt);
      prevSpeed = currentSpeed;

      // Recover from falling off the track.
      if (chassis.translation().y < -40) respawn();
    },

    dispose() {
      if (interpolator) {
        const index = physics.interpolators.indexOf(interpolator);
        if (index >= 0) physics.interpolators.splice(index, 1);
        interpolator = null;
      }
      if (controller) {
        world.removeVehicleController(controller);
        controller = null;
      }
      if (chassis) {
        world.removeRigidBody(chassis);
        chassis = null;
      }
      handle.current = null;
    },
  });
}
