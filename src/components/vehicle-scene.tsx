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

  const [chassisRef, chassisApi] = useBox(
    () => ({
      mass: 150,
      args: [vehicleConfig.width, 1, vehicleConfig.front * 2],
      position: [0, 2, 0],
      angularDamping: 0.5,
    }),
    useRef<Group>(null)
  );

  const wheelRefs: React.MutableRefObject<any>[] = [useRef(null), useRef(null), useRef(null), useRef(null)];

  const [vehicle, api] = useRaycastVehicle(() => ({
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
        if ((child as Mesh).isMesh) {
          child.castShadow = true;
        }
      });
      gltf.scene.rotation.y = Math.PI;
    }
  }, [gltf]);
  
  const velocity = useRef(new Vector3());
  useEffect(() => {
    if (chassisApi) {
      const unsubscribe = chassisApi.velocity.subscribe((v) => velocity.current.fromArray(v));
      return unsubscribe;
    }
  }, [chassisApi]);

  useFrame((state, delta) => {
    if (!vehicle.current || !api || !chassisApi) return;

    const { force, steer } = vehicleConfig;

    // Autonomous forward movement
    const engineForce = -force;
    api.applyEngineForce(engineForce, 2);
    api.applyEngineForce(engineForce, 3);

    const steerValue = controls.left ? steer : controls.right ? -steer : 0;
    api.setSteeringValue(steerValue, 0);
    api.setSteeringValue(steerValue, 1);

    if (controls.reset) {
      chassisApi.position.set(0, 2, 0);
      chassisApi.velocity.set(0, 0, 0);
      chassisApi.angularVelocity.set(0, 0, 0);
      chassisApi.rotation.set(0, 0, 0);
    }
    
    setSpeed(velocity.current.length());

    if (chassisRef.current) {
        const vehiclePosition = new Vector3();
        const vehicleQuaternion = new Quaternion();
        chassisRef.current.getWorldPosition(vehiclePosition);
        chassisRef.current.getWorldQuaternion(vehicleQuaternion);

        const cameraOffset = new Vector3(0, 4.5, 9);
        cameraOffset.applyQuaternion(vehicleQuaternion);
        cameraOffset.add(vehiclePosition);

        state.camera.position.lerp(cameraOffset, delta * 4);
        state.camera.lookAt(vehiclePosition);
    }
  });

  return (
    <group ref={vehicle}>
      <group ref={chassisRef}>
        <primitive object={gltf.scene} position={[0, -0.5, 0]}/>
      </group>
      {wheelInfos.map((_, index) => (
        <group key={index} ref={wheelRefs[index]}></group>
      ))}
    </group>
  );
}
