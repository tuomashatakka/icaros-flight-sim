
"use client"

import { useCompoundBody, useRaycastVehicle } from '@react-three/cannon';
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

  const { width, height, front, back, radius } = vehicleConfig;

  const [ref, api] = useCompoundBody(
    () => ({
      mass: 150,
      position: [0, 2, 0],
      angularDamping: 0.5,
      shapes: [
        { type: 'Box', args: [width, height, front * 2], position: [0, 0, 0] },
        { type: 'Cylinder', args: [radius, radius, 0.5, 8], rotation: [0, 0, -Math.PI / 2] },
      ],
    }),
    useRef<Group>(null)
  );

  const [vehicle, vehicleApi] = useRaycastVehicle(() => ({
    chassisBody: ref,
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
    if (!vehicle.current || !vehicleApi || !ref.current) return;

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
    ref.current.getWorldPosition(vehiclePosition);
    ref.current.getWorldQuaternion(vehicleQuaternion);

    const cameraOffset = new Vector3(0, 4.5, 9);
    cameraOffset.applyQuaternion(vehicleQuaternion);
    cameraOffset.add(vehiclePosition);

    state.camera.position.lerp(cameraOffset, delta * 4);
    state.camera.lookAt(vehiclePosition);
  });

  return (
    <group ref={vehicle}>
      <group ref={ref}>
        <primitive object={gltf.scene} position={[0, -0.5, 0]}/>
      </group>
    </group>
  );
}
