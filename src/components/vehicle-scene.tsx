"use client"

import {
  RigidBody,
  CuboidCollider,
  useRapier,
  useBeforePhysicsStep,
  type RapierRigidBody,
} from '@react-three/rapier';
import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useControls as useTuning } from 'leva';
import { useControls } from '@/hooks/use-mobile';
import { useStore } from '@/hooks/use-store';
import { useRaceStore } from '@/hooks/use-race-store';
import { vehicleConfig } from '@/lib/utils';
import { Group, MathUtils, Quaternion, Vector3, type MeshStandardMaterial } from 'three';
import { useShipStore } from '@/hooks/use-ship-store';
import { ShipVisual } from '@/components/ship-visual';

// ---------------------------------------------------------------------------
// FEEL KNOB — cosmetic lean into a turn (the signature of an anti-grav racer).
// Returns a roll angle (rad) applied around the ship's forward axis: the ship
// dips its inside edge into the corner. This is a *design* decision — there is
// no single right answer. Some shapes to try:
//   linear:  steerNorm * maxBank * speedRatio                 (current default)
//   eased:   Math.sign(steerNorm) * steerNorm*steerNorm * maxBank * speedRatio
//            -> softer near-centre, snappier at full lock
//   gated:   speedRatio < 0.3 ? 0 : steerNorm * maxBank
//            -> only leans once you're actually moving
// steerNorm is the eased turn signal in [-1, 1]; speedRatio is [0, 1].
function computeBankAngle(steerNorm: number, speedRatio: number, maxBank: number): number {
  return steerNorm * maxBank * speedRatio;
}

// Module-scope scratch — mutated each step, never reallocated (perf discipline).
const WORLD_UP_V = new Vector3(0, 1, 0);
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
const _camFwd = new Vector3();
const _camOffset = new Vector3();

export function Vehicle() {
  const { gl } = useThree();
  const { controls } = useControls(gl.domElement);
  const { setSpeed, increaseZone, zone, speedLevels, setBoostMeter, triggerCrash } = useStore();
  const { world } = useRapier();
  const { currentConfig } = useShipStore();

  const chassisRef = useRef<RapierRigidBody>(null);
  const visualRef = useRef<Group>(null);
  const controllerRef = useRef<ReturnType<typeof world.createVehicleController> | null>(null);
  const smoothedYawRateRef = useRef(0);
  const boostMeterRef = useRef(1);
  const prevSpeedRef = useRef(0);
  const crashCooldownRef = useRef(0);
  const cameraShakeRef = useRef(0);
  const boostingRef = useRef(false);

  // Live feel-tuning (populates the existing <Leva collapsed /> panel).
  const tuning = useTuning('Ship physics', {
    hoverHeight: { value: vehicleConfig.hoverHeight, min: 0.2, max: 1.6, step: 0.05 },
    suspensionStiffness: { value: vehicleConfig.suspensionStiffness, min: 5, max: 60, step: 1 },
    thrust: { value: vehicleConfig.thrust, min: 200, max: 2500, step: 50 },
    sideGrip: { value: vehicleConfig.sideGrip, min: 0.5, max: 6, step: 0.1 },
    maxYawRate: { value: vehicleConfig.maxYawRate, min: 0.5, max: 5, step: 0.1 },
    uprightStrength: { value: vehicleConfig.uprightStrength, min: 1, max: 20, step: 0.5 },
    maxBank: { value: vehicleConfig.maxBank, min: 0, max: 1.2, step: 0.05 },
  });
  const tuningRef = useRef(tuning);
  tuningRef.current = tuning;

  // Teleport back to the last cleared checkpoint (set by the RaceManager).
  const respawn = useCallback(() => {
    const chassis = chassisRef.current;
    if (!chassis) return;
    const { position, quaternion } = useRaceStore.getState().respawn;
    chassis.setTranslation({ x: position[0], y: position[1] + 1, z: position[2] }, true);
    chassis.setRotation({ x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3] }, true);
    chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
    chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
    smoothedYawRateRef.current = 0;
  }, []);

  const { width, height, front, back, wheelRadius } = vehicleConfig;

  // Wheel chassis-connection points, local space: [front-left, front-right, back-left, back-right].
  const wheels = useMemo(
    () => [
      { x: -width / 2, y: -height / 2, z: front },
      { x: width / 2, y: -height / 2, z: front },
      { x: -width / 2, y: -height / 2, z: back },
      { x: width / 2, y: -height / 2, z: back },
    ],
    [width, height, front, back]
  );

  // Build the rapier raycast-vehicle controller once the chassis exists.
  // The wheels are invisible hover pads: pure suspension + grip, no steering and
  // no per-wheel braking (turning is a single yaw source, applied in the step).
  useEffect(() => {
    const chassis = chassisRef.current;
    if (!chassis) return;
    const controller = world.createVehicleController(chassis);
    controller.indexUpAxis = 1;
    controller.setIndexForwardAxis = 2;
    const down = { x: 0, y: -1, z: 0 };
    const axle = { x: -1, y: 0, z: 0 };
    wheels.forEach((pos) => controller.addWheel(pos, down, axle, vehicleConfig.hoverHeight, wheelRadius));
    wheels.forEach((_, i) => {
      controller.setWheelSuspensionStiffness(i, vehicleConfig.suspensionStiffness);
      controller.setWheelMaxSuspensionTravel(i, vehicleConfig.suspensionTravel);
      controller.setWheelSuspensionCompression(i, vehicleConfig.suspensionCompression);
      controller.setWheelSuspensionRelaxation(i, vehicleConfig.suspensionRelaxation);
      controller.setWheelMaxSuspensionForce(i, 100000);
      controller.setWheelFrictionSlip(i, vehicleConfig.forwardGrip);
      controller.setWheelSideFrictionStiffness(i, vehicleConfig.sideGrip);
    });
    controllerRef.current = controller;
    return () => {
      controllerRef.current = null;
      world.removeVehicleController(controller);
    };
  }, [world, wheels, wheelRadius]);

  useEffect(() => {
    const id = setInterval(() => increaseZone(), 10000);
    return () => clearInterval(id);
  }, [increaseZone]);

  // Snap to the start line whenever a countdown begins (initial race + "Race again").
  const raceStatus = useRaceStore((s) => s.status);
  useEffect(() => {
    if (raceStatus !== 'countdown') return;
    const chassis = chassisRef.current;
    if (!chassis) return;
    const { position, quaternion } = useRaceStore.getState().spawn;
    chassis.setTranslation({ x: position[0], y: position[1] + 1, z: position[2] }, true);
    chassis.setRotation({ x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3] }, true);
    chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
    chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
    boostMeterRef.current = 1;
  }, [raceStatus]);

  useBeforePhysicsStep(() => {
    const controller = controllerRef.current;
    const chassis = chassisRef.current;
    if (!controller || !chassis) return;

    const dt = world.timestep;
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
    const t = tuningRef.current;

    const racing = useRaceStore.getState().status === 'racing';

    const lv = chassis.linvel();
    const currentSpeed = Math.hypot(lv.x, lv.y, lv.z);

    if (controls.reset) respawn();

    // Boost reserve: drains while held (and available), recharges otherwise.
    const boosting = racing && controls.boost && boostMeterRef.current > 0;
    boostingRef.current = boosting;
    boostMeterRef.current = Math.max(
      0,
      Math.min(1, boostMeterRef.current + (boosting ? -boostDrainRate : boostRechargeRate) * dt)
    );
    setBoostMeter(boostMeterRef.current);

    const currentZone = speedLevels.find((l) => l.zone === zone) || speedLevels[speedLevels.length - 1];
    const baseTarget = Math.min(currentZone.speedTarget, maxSpeed);
    const targetSpeed = boosting ? baseTarget * boostSpeedMultiplier : baseTarget;
    const speedRatio = Math.min(currentSpeed / Math.max(targetSpeed, 1), 1);

    // Apply live hover/grip tuning so the Leva panel updates the float in real time.
    for (let i = 0; i < 4; i++) {
      controller.setWheelSuspensionRestLength(i, t.hoverHeight);
      controller.setWheelSuspensionStiffness(i, t.suspensionStiffness);
      controller.setWheelSideFrictionStiffness(i, t.sideGrip);
    }

    // Thrust: all-wheel engine force, gated until "GO" and capped at target speed.
    // Engine force only bites while wheels touch ground, so it self-cuts in the air.
    const driveForce = boosting ? t.thrust * boostThrustMultiplier : t.thrust;
    const engineForce = racing && currentSpeed < targetSpeed ? driveForce : 0;
    for (let i = 0; i < 4; i++) {
      controller.setWheelEngineForce(i, engineForce);
      controller.setWheelSteering(i, 0);
      controller.setWheelBrake(i, 0);
    }

    // Step the suspension + friction solver. After this, wheel contacts are valid.
    controller.updateVehicle(dt);
    setSpeed(currentSpeed);

    // --- Surface-aware orientation ------------------------------------------
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
    if (grounded) _surfNormal.normalize();
    else _surfNormal.copy(WORLD_UP_V);

    // Current orientation basis.
    const rNow = chassis.rotation();
    _tmpQuat.set(rNow.x, rNow.y, rNow.z, rNow.w);
    _fwd.set(0, 0, 1).applyQuaternion(_tmpQuat);
    _up.set(0, 1, 0).applyQuaternion(_tmpQuat);

    // Eased single yaw source. steerInput in [-1, 1]; yaw authority falls off at
    // top speed (grounded) and is reduced to aftertouch while airborne.
    const steerInput = racing ? controls.steer : 0;
    const yawSpeedScale = MathUtils.lerp(1, highSpeedYawScale, speedRatio);
    const boostYawMul = controls.boost ? boostYawMultiplier : 1;
    const desiredYaw = grounded
      ? steerInput * t.maxYawRate * yawSpeedScale * boostYawMul
      : steerInput * airYawRate;
    const yawLerp = 1 - Math.exp(-yawResponse * dt);
    smoothedYawRateRef.current = MathUtils.lerp(smoothedYawRateRef.current, racing ? desiredYaw : 0, yawLerp);
    const yawRate = smoothedYawRateRef.current;

    // Cosmetic bank: lean the target-up into the turn (FEEL KNOB above).
    const steerNorm = Math.max(-1, Math.min(1, yawRate / Math.max(t.maxYawRate, 1e-3)));
    const bankAngle = grounded ? computeBankAngle(steerNorm, speedRatio, t.maxBank) : 0;
    _bankQuat.setFromAxisAngle(_fwd, -bankAngle);
    _targetUp.copy(_surfNormal).applyQuaternion(_bankQuat).normalize();

    // Tilt correction: angular velocity that rotates ship-up toward target-up.
    // Cross product gives the (pitch/roll) axis; it never contains a yaw component,
    // so driven yaw stays clean. Strength is a P-gain toward the surface.
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

    // A sharp drop in speed from a fast-enough run reads as an impact -> shake + flash.
    const decel = (prevSpeedRef.current - currentSpeed) / Math.max(dt, 1e-3);
    if (racing && prevSpeedRef.current > crashMinSpeed && decel > crashDecel && crashCooldownRef.current <= 0) {
      triggerCrash();
      cameraShakeRef.current = Math.min(1.2, decel / 110);
      crashCooldownRef.current = 0.8;
    }
    crashCooldownRef.current = Math.max(0, crashCooldownRef.current - dt);
    prevSpeedRef.current = currentSpeed;

    // Recover from falling off the track.
    if (chassis.translation().y < -40) respawn();
  });

  const camYawRef = useRef<number | null>(null);
  const smoothedLookAtPosition = useRef(new Vector3());
  const smoothedVisualPosition = useRef(new Vector3());
  const vehiclePosition = useRef(new Vector3());
  const vehicleQuaternion = useRef(new Quaternion());
  const scratch = useRef(new Vector3());

  useFrame((state, delta) => {
    const chassis = chassisRef.current;
    if (!chassis) return;

    const t = chassis.translation();
    const r = chassis.rotation();
    vehiclePosition.current.set(t.x, t.y, t.z);
    vehicleQuaternion.current.set(r.x, r.y, r.z, r.w);

    const lerpFactor = delta * 5.0;

    // Chase camera: trail the ship's HEADING at a fixed distance + height. The
    // camera stays world-level (banking the camera with the ship is nauseating);
    // it only follows yaw, smoothed shortest-path so a hard turn never swings it.
    _camFwd.set(0, 0, 1).applyQuaternion(vehicleQuaternion.current);
    const shipYaw = Math.atan2(_camFwd.x, _camFwd.z);
    if (camYawRef.current === null) camYawRef.current = shipYaw;
    let dYaw = shipYaw - camYawRef.current;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw)); // wrap to [-pi, pi]
    camYawRef.current += dYaw * (1 - Math.exp(-4 * delta));

    _camOffset.set(0, 3.4, -9).applyAxisAngle(WORLD_UP_V, camYawRef.current).add(vehiclePosition.current);
    state.camera.position.copy(_camOffset);

    // Decaying impact shake.
    if (cameraShakeRef.current > 0.001) {
      const s = cameraShakeRef.current;
      state.camera.position.x += (Math.random() - 0.5) * s * 2;
      state.camera.position.y += (Math.random() - 0.5) * s * 2;
      state.camera.position.z += (Math.random() - 0.5) * s * 2;
      cameraShakeRef.current *= Math.exp(-delta * 6);
    }

    smoothedLookAtPosition.current.lerp(
      scratch.current.copy(vehiclePosition.current).setY(vehiclePosition.current.y + 0.8),
      delta * 6
    );
    state.camera.lookAt(smoothedLookAtPosition.current);

    // Visual mesh follows the chassis (now including bank/tilt) with a small lift.
    if (visualRef.current) {
      const visualOffset = scratch.current.set(0, 0.5, 0).applyQuaternion(vehicleQuaternion.current).add(vehiclePosition.current);
      smoothedVisualPosition.current.lerp(visualOffset, lerpFactor * 3);
      visualRef.current.position.copy(smoothedVisualPosition.current);
      visualRef.current.quaternion.copy(vehicleQuaternion.current);

      // Pulse the ship's Glow material while boosting.
      const glowIntensity = boostingRef.current ? 3.6 : 1.6;
      visualRef.current.traverse((child) => {
        const mesh = child as { material?: MeshStandardMaterial | MeshStandardMaterial[] };
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        for (const mat of mats) {
          if (mat?.name === 'Glow') mat.emissiveIntensity = glowIntensity;
        }
      });
    }
  });

  return (
    <>
      <RigidBody
        ref={chassisRef}
        colliders={false}
        position={[1, 2, 4]}
        rotation={[0, Math.PI, 0]}
        linearDamping={0.1}
        angularDamping={0.5}
        canSleep={false}
        type="dynamic"
        userData={{ isVehicle: true }}
      >
        <CuboidCollider args={[width / 2, height / 2, front]} mass={vehicleConfig.mass} />
      </RigidBody>
      <group ref={visualRef}>
        <ShipVisual config={currentConfig} targetSize={3.1} position={[0, 0.1, 0]} />
      </group>
    </>
  );
}
