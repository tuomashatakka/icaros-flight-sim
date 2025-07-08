"use client"

import { useRaycastVehicle } from '@react-three/cannon';
import { useFrame, useLoader } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useControls } from '@/hooks/use-mobile';
import { useStore } from '@/hooks/use-toast';
import { vehicleConfig, wheelInfos } from '@/lib/utils';
import type { Group, Mesh } from 'three';
import { Quaternion, Vector3 } from 'three';

export function Vehicle() {
  const controls = useControls();
  const setSpeed = useStore((state) => state.setSpeed);
  
  const chassisRef = useRef<Group>(null!);
  
  const gltf = useLoader(GLTFLoader, 'https://tuomashatakka.github.io/public/resources/models/vehicles/honda_s2000_gt_ap2/scene.gltf');
  
  const wheelRefs: React.MutableRefObject<any>[] = [useRef(), useRef(), useRef(), useRef()];

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
    }
  }, [gltf]);

  useFrame((state, delta) => {
    if (!vehicle.current) return;
    
    const { force, steer, maxBrake } = vehicleConfig;
    
    const engineForce = controls.forward ? -force : controls.backward ? force : 0;
    api.applyEngineForce(engineForce, 2);
    api.applyEngineForce(engineForce, 3);
    
    const steerValue = controls.left ? steer : controls.right ? -steer : 0;
    api.setSteeringValue(steerValue, 0);
    api.setSteeringValue(steerValue, 1);
    
    api.setBrake(controls.brake ? maxBrake : 0, 0);
    api.setBrake(controls.brake ? maxBrake : 0, 1);
    api.setBrake(controls.brake ? maxBrake : 0, 2);
    api.setBrake(controls.brake ? maxBrake : 0, 3);
    
    if (controls.reset) {
      api.chassis.position.set(0, 2, 0);
      api.chassis.velocity.set(0, 0, 0);
      api.chassis.angularVelocity.set(0, 0, 0);
      api.chassis.quaternion.set(0, 0, 0, 1);
    }

    const speed = vehicle.current.getVehicleSpeed();
    setSpeed(speed);

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
    <group ref={vehicle}>
      <group ref={chassisRef}>
        <primitive object={gltf.scene} rotation={[0, Math.PI, 0]} position={[0, -0.38, 0]}/>
      </group>
      {/* Wheels are physically present but not rendered; raycast handles them */}
      {wheelInfos.map((wheel, index) => (
        <group key={index} ref={wheelRefs[index]}></group>
      ))}
    </group>
  );
}
