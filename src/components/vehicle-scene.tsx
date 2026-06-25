"use client"

import {
  RigidBody,
  CuboidCollider,
  useRapier,
  useBeforePhysicsStep,
  type RapierRigidBody,
} from '@react-three/rapier';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { useControls } from '@/hooks/use-mobile';
import { useStore } from '@/hooks/use-store';
import { vehicleConfig } from '@/lib/utils';
import { Group, MathUtils, Quaternion, Vector3 } from 'three';
import { useShipStore } from '@/hooks/use-ship-store';
import { ShipVisual } from '@/components/ship-visual';

const SUSPENSION_REST = 0.4;

export function Vehicle() {
  const { gl } = useThree();
  const { controls } = useControls(gl.domElement);
  const { setSpeed, increaseZone, zone, speedLevels } = useStore();
  const { world } = useRapier();
  const { currentConfig } = useShipStore();

  const chassisRef = useRef<RapierRigidBody>(null);
  const visualRef = useRef<Group>(null);
  const controllerRef = useRef<ReturnType<typeof world.createVehicleController> | null>(null);
  const smoothedSteerRef = useRef(0);

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
    const id = setInterval(() => increaseZone(), 5000);
    return () => clearInterval(id);
  }, [increaseZone]);

  useBeforePhysicsStep(() => {
    const controller = controllerRef.current;
    const chassis = chassisRef.current;
    if (!controller || !chassis) return;

    const {
      force,
      steer,
      maxBrake,
      boostSteerMultiplier,
      steeringResponse,
      highSpeedSteerScale,
      yawAssist,
    } = vehicleConfig;

    const currentZone = speedLevels.find((l) => l.zone === zone) || speedLevels[speedLevels.length - 1];
    const targetSpeed = currentZone.speedTarget;
    const lv = chassis.linvel();
    const currentSpeed = Math.hypot(lv.x, lv.y, lv.z);
    const speedRatio = Math.min(currentSpeed / Math.max(targetSpeed, 1), 1);

    const engineForce = currentSpeed < targetSpeed ? force : 0;
    controller.setWheelEngineForce(0, 0);
    controller.setWheelEngineForce(1, 0);
    // Rear wheels drive (indices 2, 3).
    controller.setWheelEngineForce(2, engineForce);
    controller.setWheelEngineForce(3, engineForce);

    const speedSteerScale = MathUtils.lerp(1, highSpeedSteerScale, speedRatio);
    const steerMultiplier = controls.boost ? boostSteerMultiplier : 1;
    const targetSteer = controls.steer * steer * steerMultiplier * speedSteerScale;
    const steerLerp = 1 - Math.exp(-steeringResponse * world.timestep);
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
    chassis.addTorque({ x: 0, y: steerValue * yawAssist * MathUtils.lerp(0.4, 1, speedRatio), z: 0 }, true);

    if (controls.reset) {
      chassis.setTranslation({ x: -10, y: 2, z: -20 }, true);
      chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
      chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
      chassis.setRotation({ x: 0, y: 1, z: 0, w: 0 }, true);
      smoothedSteerRef.current = 0;
    }

    controller.updateVehicle(world.timestep);
    setSpeed(currentSpeed);
  });

  const smoothedCameraPosition = useRef(new Vector3(0, 5, 15));
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

    // Chase camera: behind and above, in vehicle space.
    const cameraOffset = scratch.current.set(0, 3.5, -8).applyQuaternion(vehicleQuaternion.current).add(vehiclePosition.current);
    smoothedCameraPosition.current.lerp(cameraOffset, lerpFactor);
    smoothedLookAtPosition.current.lerp(
      scratch.current.copy(vehiclePosition.current).setY(vehiclePosition.current.y + 0.5),
      lerpFactor
    );
    state.camera.position.copy(smoothedCameraPosition.current);
    state.camera.lookAt(smoothedLookAtPosition.current);

    // Visual mesh follows the chassis with a small lift.
    if (visualRef.current) {
      const visualOffset = scratch.current.set(0, 0.5, 0).applyQuaternion(vehicleQuaternion.current).add(vehiclePosition.current);
      smoothedVisualPosition.current.lerp(visualOffset, lerpFactor * 3);
      visualRef.current.position.copy(smoothedVisualPosition.current);
      visualRef.current.quaternion.copy(vehicleQuaternion.current);
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
      >
        <CuboidCollider args={[width / 2, height / 2, front]} mass={150} />
      </RigidBody>
      <group ref={visualRef}>
        <ShipVisual config={currentConfig} targetSize={3.1} position={[0, 0.1, 0]} />
      </group>
    </>
  );
}
