
"use client"

import { useBox, useRaycastVehicle } from '@react-three/cannon';
import { useFrame, useLoader } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useControls } from '@/hooks/use-mobile';
import { useStore } from '@/hooks/use-store';
import { vehicleConfig, wheelInfos } from '@/lib/utils';
import type { Group, Mesh } from 'three';
import { Quaternion, Vector3 } from 'three';

export function Vehicle() {
  const controls = useControls(state => state.controls);
  const setSpeed = useStore((state) => state.setSpeed);
  
  const gltf = useLoader(GLTFLoader, 'https://tuomashatakka.github.io/public/resources/models/vehicles/honda_s2000_gt_ap2/scene.gltf');

  const { width, height, front } = vehicleConfig;

  const chassisBody = useRef<Group>(null);
  const [ref, api] = useBox(
    () => ({
      mass: 150,
      position: [0, 2, 0],
      angularDamping: 0.5,
      args: [width, height, front * 2]
    }),
    chassisBody
  );

  const wheel1 = useRef<Group>(null)
  const wheel2 = useRef<Group>(null)
  const wheel3 = useRef<Group>(null)
  const wheel4 = useRef<Group>(null)
  const wheelRefs = [wheel1, wheel2, wheel3, wheel4]

  const [vehicle, vehicleApi] = useRaycastVehicle(() => ({
    chassisBody: chassisBody,
    wheels: wheelRefs,
    wheelInfos,
    indexForwardAxis: 2,
    indexRightAxis: 0,
    indexUpAxis: 1,
  }));

  useEffect(() => {
    if (gltf.scene) {
      gltf.scene.traverse((child) => {
        if ((child as Mesh).isMesh) {
          child.castShadow = true;
        }
      });
      gltf.scene.rotation.y = Math.PI;
    }
  }, [gltf]);
  
  const velocity = useRef(new Vector3());
  useEffect(() => {
    if (api) {
      const unsubscribe = api.velocity.subscribe((v) => velocity.current.fromArray(v));
      return unsubscribe;
    }
  }, [api]);

  useFrame((state, delta) => {
    if (!vehicle.current || !vehicleApi || !chassisBody.current) return;

    const { force, steer } = vehicleConfig;

    // Autonomous forward movement
    const engineForce = -force;
    vehicleApi.applyEngineForce(engineForce, 2);
    vehicleApi.applyEngineForce(engineForce, 3);

    const steerValue = controls.left ? steer : controls.right ? -steer : 0;
    vehicleApi.setSteeringValue(steerValue, 0);
    vehicleApi.setSteeringValue(steerValue, 1);

    if (controls.reset) {
      api.position.set(0, 2, 0);
      api.velocity.set(0, 0, 0);
      api.angularVelocity.set(0, 0, 0);
      api.rotation.set(0, 0, 0);
    }
    
    setSpeed(velocity.current.length());

    const vehiclePosition = new Vector3();
    const vehicleQuaternion = new Quaternion();
    chassisBody.current.getWorldPosition(vehiclePosition);
    chassisBody.current.getWorldQuaternion(vehicleQuaternion);

    const cameraOffset = new Vector3(0, 4.5, 9);
    cameraOffset.applyQuaternion(vehicleQuaternion);
    cameraOffset.add(vehiclePosition);

    state.camera.position.lerp(cameraOffset, delta * 4);
    state.camera.lookAt(vehiclePosition);
  });

  return (
    <group ref={vehicle}>
      <group ref={chassisBody}>
        <primitive object={gltf.scene} position={[0, -0.5, 0]}/>
      </group>
      <group ref={wheel1}></group>
      <group ref={wheel2}></group>
      <group ref={wheel3}></group>
      <group ref={wheel4}></group>
    </group>
  );
}
