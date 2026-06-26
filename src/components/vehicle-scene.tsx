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
import { useControls } from '@/hooks/use-mobile';
import { useStore } from '@/hooks/use-store';
import { useRaceStore } from '@/hooks/use-race-store';
import { vehicleConfig } from '@/lib/utils';
import { Group, MathUtils, Quaternion, Vector3, type MeshStandardMaterial } from 'three';
import { useShipStore } from '@/hooks/use-ship-store';
import { ShipVisual } from '@/components/ship-visual';

const SUSPENSION_REST = 0.4;

// Module-scope scratch — mutated each step, never reallocated (perf discipline).
const WORLD_UP_V = new Vector3(0, 1, 0);
const _fwd = new Vector3();
const _tmpQuat = new Quaternion();
const _yawQuat = new Quaternion();
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
  const smoothedSteerRef = useRef(0);
  const boostMeterRef = useRef(1);
  const prevSpeedRef = useRef(0);
  const crashCooldownRef = useRef(0);
  const flipTimerRef = useRef(0);
  const cameraShakeRef = useRef(0);
  const boostingRef = useRef(false);

  // Teleport back to the last cleared checkpoint (set by the RaceManager).
  const respawn = useCallback(() => {
    const chassis = chassisRef.current;
    if (!chassis) return;
    const { position, quaternion } = useRaceStore.getState().respawn;
    chassis.setTranslation({ x: position[0], y: position[1] + 1, z: position[2] }, true);
    chassis.setRotation({ x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3] }, true);
    chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
    chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
    smoothedSteerRef.current = 0;
  }, []);

  const { width, height, front, back, radius } = vehicleConfig;

  // Wheel chassis-connection points, local space: [front-left, front-right, back-left, back-right]
  const wheels = useMemo(
    () => [
      { x: -width / 2, y: -height / 2, z: front },
      { x: width / 2, y: -height / 2, z: front },
      { x: -width / 2, y: -height / 2, z: back },
      { x: width / 2, y: -height / 2, z: back },
    ],
    [width, height, front, back]
  );

  // Build the rapier raycast-vehicle controller once the chassis rigid body exists.
  useEffect(() => {
    const chassis = chassisRef.current;
    if (!chassis) return;
    const controller = world.createVehicleController(chassis);
    controller.indexUpAxis = 1;
    controller.setIndexForwardAxis = 2;
    const down = { x: 0, y: -1, z: 0 };
    const axle = { x: -1, y: 0, z: 0 };
    wheels.forEach((pos) => controller.addWheel(pos, down, axle, SUSPENSION_REST, radius));
    wheels.forEach((_, i) => {
      controller.setWheelSuspensionStiffness(i, 34);
      controller.setWheelMaxSuspensionTravel(i, 0.55);
      controller.setWheelSuspensionCompression(i, 4.5);
      controller.setWheelSuspensionRelaxation(i, 8);
      controller.setWheelMaxSuspensionForce(i, 100000);
      controller.setWheelFrictionSlip(i, 2.35);
      controller.setWheelSideFrictionStiffness(i, i < 2 ? 1.35 : 1.8);
    });
    controllerRef.current = controller;
    return () => {
      controllerRef.current = null;
      world.removeVehicleController(controller);
    };
  }, [world, wheels, radius]);

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
      force,
      steer,
      maxBrake,
      maxSpeed,
      boostSteerMultiplier,
      steeringResponse,
      highSpeedSteerScale,
      yawAssist,
      boostForceMultiplier,
      boostSpeedMultiplier,
      boostDrainRate,
      boostRechargeRate,
      aftertouchTorque,
      crashDecel,
      crashMinSpeed,
    } = vehicleConfig;

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
    // Clamp the runaway zone targets to a sane cruise ceiling so the car stays drivable.
    const baseTarget = Math.min(currentZone.speedTarget, maxSpeed);
    const targetSpeed = boosting ? baseTarget * boostSpeedMultiplier : baseTarget;
    const speedRatio = Math.min(currentSpeed / Math.max(targetSpeed, 1), 1);

    // Engine is gated until "GO" — no creeping during the countdown.
    const driveForce = boosting ? force * boostForceMultiplier : force;
    const engineForce = racing && currentSpeed < targetSpeed ? driveForce : 0;
    controller.setWheelEngineForce(0, 0);
    controller.setWheelEngineForce(1, 0);
    // Rear wheels drive (indices 2, 3).
    controller.setWheelEngineForce(2, engineForce);
    controller.setWheelEngineForce(3, engineForce);

    const steerInput = racing ? controls.steer : 0;
    const speedSteerScale = MathUtils.lerp(1, highSpeedSteerScale, speedRatio);
    const steerMultiplier = controls.boost ? boostSteerMultiplier : 1;
    const targetSteer = steerInput * steer * steerMultiplier * speedSteerScale;
    const steerLerp = 1 - Math.exp(-steeringResponse * dt);
    smoothedSteerRef.current = MathUtils.lerp(smoothedSteerRef.current, targetSteer, steerLerp);
    const steerValue = smoothedSteerRef.current;
    controller.setWheelSteering(0, steerValue);
    controller.setWheelSteering(1, steerValue);

    // Light rear inside-wheel braking and yaw assist keep turns responsive without snapping.
    const brake = Math.abs(steerValue) * maxBrake * MathUtils.lerp(0.35, 1, speedRatio);
    controller.setWheelBrake(0, 0);
    controller.setWheelBrake(1, 0);
    controller.setWheelBrake(2, steerValue > 0 ? brake : 0);
    controller.setWheelBrake(3, steerValue < 0 ? brake : 0);

    let grounded = false;
    for (let i = 0; i < 4; i++) {
      if (controller.wheelIsInContact(i)) {
        grounded = true;
        break;
      }
    }

    // Yaw (heading) torque about world up — pure steering. The chassis is kept
    // level below, so world-up is always the ship's up and this is unambiguous yaw.
    const yawTorque = grounded
      ? steerValue * yawAssist * MathUtils.lerp(0.4, 1, speedRatio)
      : steerInput * aftertouchTorque;
    chassis.addTorque({ x: 0, y: racing ? yawTorque : 0, z: 0 }, true);

    controller.updateVehicle(dt);
    setSpeed(currentSpeed);

    // --- Upright lock (flat-ground model) ------------------------------------
    // The ship may only yaw. Each step we rewrite the rotation to a pure-heading
    // quaternion and zero the pitch/roll spin, so it physically cannot tip or
    // barrel-roll and world-up stays the ship's up. (Banked tracks will later
    // align this to the surface normal instead of world up.)
    const rNow = chassis.rotation();
    _fwd.set(0, 0, 1).applyQuaternion(_tmpQuat.set(rNow.x, rNow.y, rNow.z, rNow.w));
    const heading = Math.atan2(_fwd.x, _fwd.z);
    _yawQuat.setFromAxisAngle(WORLD_UP_V, heading);
    chassis.setRotation({ x: _yawQuat.x, y: _yawQuat.y, z: _yawQuat.z, w: _yawQuat.w }, true);
    const avNow = chassis.angvel();
    chassis.setAngvel({ x: 0, y: avNow.y, z: 0 }, true);

    // Safety net: never let a solver glitch fling the body past a sane speed.
    const lvNow = chassis.linvel();
    const spNow = Math.hypot(lvNow.x, lvNow.y, lvNow.z);
    const speedCap = maxSpeed * boostSpeedMultiplier * 1.4;
    if (spNow > speedCap) {
      const s = speedCap / spNow;
      chassis.setLinvel({ x: lvNow.x * s, y: lvNow.y * s, z: lvNow.z * s }, true);
    }

    // A sharp drop in speed from a fast-enough run reads as an impact → shake + flash.
    const decel = (prevSpeedRef.current - currentSpeed) / Math.max(dt, 1e-3);
    if (racing && prevSpeedRef.current > crashMinSpeed && decel > crashDecel && crashCooldownRef.current <= 0) {
      triggerCrash();
      cameraShakeRef.current = Math.min(1.2, decel / 110);
      crashCooldownRef.current = 0.8;
    }
    crashCooldownRef.current = Math.max(0, crashCooldownRef.current - dt);
    prevSpeedRef.current = currentSpeed;

    // Recover from falling off the track or sitting upside-down.
    if (chassis.translation().y < -40) respawn();
    const rot = chassis.rotation();
    const upY = 1 - 2 * (rot.x * rot.x + rot.z * rot.z);
    if (upY < -0.2) {
      flipTimerRef.current += dt;
      if (flipTimerRef.current > 2) {
        respawn();
        flipTimerRef.current = 0;
      }
    } else {
      flipTimerRef.current = 0;
    }
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

    // Chase camera: trail the ship's HEADING at a fixed distance + height.
    // Smoothing the camera yaw (shortest-path, framerate-independent) toward the
    // ship's heading — rather than lerping a world position — means a hard, fast
    // turn can never pull the camera in on top of the ship or swing it side-on;
    // it always settles directly behind.
    _camFwd.set(0, 0, 1).applyQuaternion(vehicleQuaternion.current);
    const shipYaw = Math.atan2(_camFwd.x, _camFwd.z);
    if (camYawRef.current === null) camYawRef.current = shipYaw;
    let dYaw = shipYaw - camYawRef.current;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw)); // wrap to [-π, π]
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

    // Visual mesh follows the chassis with a small lift.
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
        linearDamping={0.12}
        angularDamping={1.65}
        canSleep={false}
        type="dynamic"
        userData={{ isVehicle: true }}
      >
        <CuboidCollider args={[width / 2, height / 2, front]} mass={150} />
      </RigidBody>
      <group ref={visualRef}>
        <ShipVisual config={currentConfig} targetSize={3.1} position={[0, 0.1, 0]} />
      </group>
    </>
  );
}
