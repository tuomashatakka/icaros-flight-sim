
"use client"

import { useBox, useRaycastVehicle } from '@react-three/cannon';
import { useFrame, useLoader } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useControls } from '@/hooks/use-mobile';
import { useStore } from '@/hooks/use-store';
import { vehicleConfig, wheelInfos } from '@/lib/utils';
import type { Object3D } from 'three';
import { Quaternion, Vector3 } from 'three';

export function Vehicle() {
  const controls = useControls(state => state.controls);
  const setSpeed = useStore((state) => state.setSpeed);
  
  const gltf = useLoader(GLTFLoader, 'https://tuomashatakka.github.io/public/resources/models/vehicles/honda_s2000_gt_ap2/scene.gltf');

  const { width, height, front } = vehicleConfig;

  const [chassisRef, chassisApi] = useBox(
    () => ({
      mass: 150,
      position: [0, 2, 0],
      angularDamping: 0.5,
      args: [width, height, front * 2]
    }),
  );

  const wheelRefs = [useRef<Object3D>(null), useRef<Object3D>(null), useRef<Object3D>(null), useRef<Object3D>(null)];

  const [vehicleRef, vehicleApi] = useRaycastVehicle(() => ({
    chassisBody: chassisRef,
    wheels: wheelRefs,
    wheelInfos,
    indexForwardAxis: 2,
    indexRightAxis: 0,
    indexUpAxis: 1,
  }));

  useEffect(() => {
    if (gltf.scene) {
      gltf.scene.traverse((child) => {
        if ('isMesh' in child && child.isMesh) {
          child.castShadow = true;
        }
      });
      gltf.scene.rotation.y = Math.PI;
    }
  }, [gltf]);
  
  const velocity = useRef(new Vector3());
  useEffect(() => {
    chassisApi.velocity.subscribe((v) => velocity.current.fromArray(v));
  }, [chassisApi]);

  useFrame((state, delta) => {
    if (!vehicleRef.current || !vehicleApi || !chassisRef.current) return;

    const { force, steer } = vehicleConfig;

    // Autonomous forward movement
    const engineForce = -force;
    vehicleApi.applyEngineForce(engineForce, 2);
    vehicleApi.applyEngineForce(engineForce, 3);

    const steerValue = controls.left ? steer : controls.right ? -steer : 0;
    vehicleApi.setSteeringValue(steerValue, 0);
    vehicleApi.setSteeringValue(steerValue, 1);

    if (controls.reset) {
      chassisApi.position.set(0, 2, 0);
      chassisApi.velocity.set(0, 0, 0);
      chassisApi.angularVelocity.set(0, 0, 0);
      chassisApi.rotation.set(0, 0, 0);
    }
    
    setSpeed(velocity.current.length());

    const vehiclePosition = new Vector3();
    const vehicleQuaternion = new Quaternion();
    chassisRef.current.getWorldPosition(vehiclePosition);
    chassisRef.current.getWorldQuaternion(vehicleQuaternion);

    const cameraOffset = new Vector3(0, 4.5, 9);
    cameraOffset.applyQuaternion(vehicleQuaternion);
    cameraOffset.add(vehiclePosition);

    state.camera.position.lerp(cameraOffset, delta * 4);
    state.camera.lookAt(vehiclePosition);
  });

  return (
    <group ref={vehicleRef}>
      <group ref={chassisRef}>
        <primitive object={gltf.scene} position={[0, -0.5, 0]}/>
      </group>
      <group ref={wheelRefs[0]}></group>
      <group ref={wheelRefs[1]}></group>
      <group ref={wheelRefs[2]}></group>
      <group ref={wheelRefs[3]}></group>
    </group>
  );
}
