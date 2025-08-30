
"use client"

import { useBox, useRaycastVehicle, useSphere } from '@react-three/cannon';
import { useFrame, useLoader } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useControls } from '@/hooks/use-mobile';
import { useStore } from '@/hooks/use-store';
import { COLLISION_GROUPS, vehicleConfig, wheelInfos } from '@/lib/utils';
import type { Object3D } from 'three';
import { Quaternion, Vector3, Group, Euler } from 'three';

export function Vehicle() {
  const { controls } = useControls();
  const { setSpeed, increaseZone, zone, speedLevels } = useStore();
  
  const carGltf = useLoader(GLTFLoader, '/spaceship_-_cb1/scene.gltf');
  
  const position: [number, number, number] = [1, 2, 4];
  const { radius } = vehicleConfig;

  const chassisRef = useRef<Object3D>(null);
  const visualRef = useRef<Object3D>(null);
  
  const [chassisBody, chassisApi] = useBox(
    () => ({
      mass: 150,
      position,
      angularDamping: 0.95,
      args: [vehicleConfig.width, vehicleConfig.height, vehicleConfig.front * 2],
      rotation: [0, Math.PI, 0],
      collisionFilterGroup: COLLISION_GROUPS.VEHICLE,
      collisionFilterMask: COLLISION_GROUPS.GROUND
    }),
    chassisRef
  );

  const wheelBodies = [useRef<Object3D>(null), useRef<Object3D>(null), useRef<Object3D>(null), useRef<Object3D>(null)];
  
  const sphereArgs: [number] = [radius];
  useSphere(() => ({ mass: 1, type: 'Kinematic', collisionFilterGroup: 0, args: sphereArgs }), wheelBodies[0]);
  useSphere(() => ({ mass: 1, type: 'Kinematic', collisionFilterGroup: 0, args: sphereArgs }), wheelBodies[1]);
  useSphere(() => ({ mass: 1, type: 'Kinematic', collisionFilterGroup: 0, args: sphereArgs }), wheelBodies[2]);
  useSphere(() => ({ mass: 1, type: 'Kinematic', collisionFilterGroup: 0, args: sphereArgs }), wheelBodies[3]);

  const [vehicle, vehicleApi] = useRaycastVehicle(() => ({
    chassisBody: chassisRef,
    wheels: wheelBodies,
    wheelInfos,
    indexForwardAxis: 2,
    indexRightAxis: 0,
    indexUpAxis: 1,
  }));
  
  useEffect(() => {
    if (carGltf.scene) {
      carGltf.scene.traverse((child) => {
        if ('isMesh' in child && child.isMesh) {
          child.castShadow = true;
        }
      });
    }
  }, [carGltf]);
  
  const velocity = useRef(new Vector3());
  
  useEffect(() => {
    if (chassisApi) {
        const unsubscribe = chassisApi.velocity.subscribe((v) => velocity.current.fromArray(v));
        return unsubscribe;
    }
  }, [chassisApi]);

  useEffect(() => {
      const interval = setInterval(() => {
        increaseZone();
      }, 5000);
      return () => clearInterval(interval);
  }, [increaseZone])


  const smoothedCameraPosition = useRef(new Vector3(0, 5, 15));
  const smoothedLookAtPosition = useRef(new Vector3());

  const smoothedVisualPosition = useRef(new Vector3(0, 0, 0))
  const smoothedVisualRotation = useRef(new Euler(0, 0, 0))

  useFrame((state, delta) => {
    if (!vehicle.current || !vehicleApi || !chassisRef.current) return;

    const { force, steer, maxBrake } = vehicleConfig;
    
    // Automatic forward force based on current zone
    const currentZone = speedLevels.find(l => l.zone === zone) || speedLevels[speedLevels.length - 1];
    const targetSpeed = currentZone.speedTarget;
    const currentSpeed = velocity.current.length();
    
    let engineForce = 0;
    if (currentSpeed < targetSpeed) {
      engineForce = -force;
    }

    vehicleApi.applyEngineForce(engineForce, 2);
    vehicleApi.applyEngineForce(engineForce, 3);
    
    const steerMultiplier = controls.boost ? 2.5 : 1;
    const steerValue = controls.steer * steer * steerMultiplier;
    vehicleApi.setSteeringValue(steerValue, 0);
    vehicleApi.setSteeringValue(steerValue, 1);
    
    // Braking based on steering
    let brakeForce = 0;
    if (steerValue > 0) { // Turning left
      brakeForce = maxBrake * steerValue;
      vehicleApi.setBrake(brakeForce, 0); // Front-left
      vehicleApi.setBrake(brakeForce, 2); // Rear-left
      vehicleApi.setBrake(0, 1);
      vehicleApi.setBrake(0, 3);
    } else if (steerValue < 0) { // Turning right
      brakeForce = maxBrake * -steerValue;
      vehicleApi.setBrake(brakeForce, 1); // Front-right
      vehicleApi.setBrake(brakeForce, 3); // Rear-right
      vehicleApi.setBrake(0, 0);
      vehicleApi.setBrake(0, 2);
    } else {
        vehicleApi.setBrake(0, 0);
        vehicleApi.setBrake(0, 1);
        vehicleApi.setBrake(0, 2);
        vehicleApi.setBrake(0, 3);
    }

    if (controls.reset) {
      chassisApi.position.set(-10, 2, -20);
      chassisApi.velocity.set(0, 0, 0);
      chassisApi.angularVelocity.set(0, 0, 0);
      chassisApi.rotation.set(0, Math.PI, 0);
    }
    
    setSpeed(currentSpeed);

    // Chase camera logic
    const vehiclePosition = new Vector3();
    const vehicleQuaternion = new Quaternion();

    chassisRef.current.getWorldPosition(vehiclePosition);
    chassisRef.current.getWorldQuaternion(vehicleQuaternion);
    
    const cameraOffset = new Vector3(0, 3.5, -8); // Position camera behind and slightly above
    cameraOffset.applyQuaternion(vehicleQuaternion);
    cameraOffset.add(vehiclePosition);
    
    const lookAtPoint = vehiclePosition.clone();
    lookAtPoint.y += 0.5;

    const lerpFactor = delta * 5.0; // Increase for faster following
    smoothedCameraPosition.current.lerp(cameraOffset, lerpFactor);
    smoothedLookAtPosition.current.lerp(lookAtPoint, lerpFactor);

    state.camera.position.copy(smoothedCameraPosition.current);
    state.camera.lookAt(smoothedLookAtPosition.current);

    const visualOffset = new Vector3(0, 0.5, 0);
    visualOffset.applyQuaternion(vehicleQuaternion);
    visualOffset.add(vehiclePosition);
    smoothedVisualPosition.current.lerp(visualOffset, lerpFactor * 3);
    smoothedVisualRotation.current.setFromQuaternion(vehicleQuaternion)

    visualRef.current?.position.copy(smoothedVisualPosition.current)
    visualRef.current?.rotation.copy(smoothedVisualRotation.current)
  });

  return <>
    <group ref={vehicle as React.Ref<Group>}>
      <group ref={chassisRef}>
        <primitive object={chassisBody} position={[0, 0.5, 2.35]} rotation={[0, -Math.PI / 2, 0]}/>
      </group>
    </group>
    <group ref={visualRef} scale={0.07}>
      <primitive object={carGltf.scene} position={[0, 0, 15]} rotation={[0, -Math.PI / 2, 0]} />
    </group>
  </>
}
