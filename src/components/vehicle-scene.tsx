"use client"

import {
  RigidBody,
  CuboidCollider,
  useRapier,
  useBeforePhysicsStep,
  type RapierRigidBody,
} from '@react-three/rapier';
import { useFrame, useLoader } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useControls } from '@/hooks/use-mobile';
import { useStore } from '@/hooks/use-store';
import { vehicleConfig } from '@/lib/utils';
import { Quaternion, Vector3, Group } from 'three';
import { useShipStore } from '@/hooks/use-ship-store';
import { SHIP_PRESETS, applyShipConfig } from '@/lib/ship/materials';

const SUSPENSION_REST = 0.4;

export function Vehicle() {
  const { controls } = useControls();
  const { setSpeed, increaseZone, zone, speedLevels } = useStore();
  const { world } = useRapier();
  const { currentConfig, selectShip } = useShipStore();

  const carGltf = useLoader(GLTFLoader, SHIP_PRESETS[currentConfig.shipId].path);

  const chassisRef = useRef<RapierRigidBody>(null);
  const visualRef = useRef<Group>(null);
  const controllerRef = useRef<ReturnType<typeof world.createVehicleController> | null>(null);
  const prevConfigRef = useRef(currentConfig);

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

  // Set the ship ID based on the current config
  useEffect(() => {
    selectShip(currentConfig.shipId);
  }, [currentConfig.shipId, selectShip]);

  // Apply initial config and handle config changes efficiently
  useEffect(() => {
    if (!carGltf.scene) return;
    
    // Store current config for comparison
    const current = currentConfig;
    const prev = prevConfigRef.current;
    
    // Check if config actually changed
    const configChanged = 
      current.shipId !== prev.shipId ||
      current.bodyColor !== prev.bodyColor ||
      current.emissiveColor !== prev.emissiveColor ||
      current.metalness !== prev.metalness ||
      current.roughness !== prev.roughness ||
      current.emissiveIntensity !== prev.emissiveIntensity ||
      current.texturePreset !== prev.texturePreset ||
      current.textureRepeat !== prev.textureRepeat ||
      current.paletteName !== prev.paletteName;
    
    if (configChanged) {
      // Apply the ship configuration
      applyShipConfig(carGltf.scene, currentConfig);
      
      carGltf.scene.traverse((child) => {
        if ('isMesh' in child && (child as { isMesh?: boolean }).isMesh) {
          (child as { castShadow: boolean }).castShadow = true;
        }
      });
      
      prevConfigRef.current = currentConfig;
    }
  }, [carGltf, currentConfig]);

  // Build the rapier raycast-vehicle controller once the chassis rigid body exists.
  useEffect(() => {
    const chassis = chassisRef.current;
    if (!chassis) return;
    const controller = world.createVehicleController(chassis);
    const down = { x: 0, y: -1, z: 0 };
    const axle = { x: -1, y: 0, z: 0 };
    wheels.forEach((pos) => controller.addWheel(pos, down, axle, SUSPENSION_REST, radius));
    wheels.forEach((_, i) => {
      controller.setWheelSuspensionStiffness(i, 24);
      controller.setWheelMaxSuspensionTravel(i, 0.6);
      controller.setWheelSuspensionCompression(i, 2);
      controller.setWheelSuspensionRelaxation(i, 10);
      controller.setWheelFrictionSlip(i, 1.5);
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

    const { force, steer, maxBrake } = vehicleConfig;

    const currentZone = speedLevels.find((l) => l.zone === zone) || speedLevels[speedLevels.length - 1];
    const targetSpeed = currentZone.speedTarget;
    const lv = chassis.linvel();
    const currentSpeed = Math.hypot(lv.x, lv.y, lv.z);

    const engineForce = currentSpeed < targetSpeed ? force : 0;
    // Rear wheels drive (indices 2, 3).
    controller.setWheelEngineForce(2, engineForce);
    controller.setWheelEngineForce(3, engineForce);

    const steerMultiplier = controls.boost ? 2.5 : 1;
    const steerValue = controls.steer * steer * steerMultiplier;
    controller.setWheelSteering(0, steerValue);
    controller.setWheelSteering(1, steerValue);

    // Differential braking helps the turn bite.
    const brake = Math.abs(steerValue) * maxBrake;
    controller.setWheelBrake(0, steerValue > 0 ? brake : 0);
    controller.setWheelBrake(2, steerValue > 0 ? brake : 0);
    controller.setWheelBrake(1, steerValue < 0 ? brake : 0);
    controller.setWheelBrake(3, steerValue < 0 ? brake : 0);

    if (controls.reset) {
      chassis.setTranslation({ x: -10, y: 2, z: -20 }, true);
      chassis.setLinvel({ x: 0, y: 0, z: 0 }, true);
      chassis.setAngvel({ x: 0, y: 0, z: 0 }, true);
      chassis.setRotation({ x: 0, y: 1, z: 0, w: 0 }, true);
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
        angularDamping={0.95}
        canSleep={false}
        type="dynamic"
      >
        <CuboidCollider args={[width / 2, height / 2, front]} mass={150} />
      </RigidBody>
      <group ref={visualRef} scale={0.07}>
        <primitive object={carGltf.scene} position={[0, 0, 15]} rotation={[0, -Math.PI / 2, 0]} />
      </group>
    </>
  );
}
