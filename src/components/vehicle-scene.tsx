
"use client"

import { useBox, useRaycastVehicle, useSphere } from '@react-three/cannon';
import { useFrame, useLoader } from '@react-three/fiber';
import { useEffect, useRef, forwardRef } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useControls } from '@/hooks/use-mobile';
import { useStore } from '@/hooks/use-store';
import { vehicleConfig, wheelInfos } from '@/lib/utils';
import type { Object3D } from 'three';
import { Quaternion, Vector3, Group } from 'three';

const Wheel = forwardRef<Group, { radius: number }>(({ radius }, ref) => {
  const wheelGltf = useLoader(GLTFLoader, 'https://tuomashatakka.github.io/public/resources/models/vehicles/vorsteiner_v-ff109/scene.gltf');
  
  useEffect(() => {
    if (wheelGltf.scene) {
      wheelGltf.scene.traverse((child) => {
        if ('isMesh' in child && child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    }
  }, [wheelGltf]);

  return (
    <group ref={ref}>
      <primitive object={wheelGltf.scene.clone()} rotation={[0, -Math.PI / 2, 0]} scale={0.08} />
    </group>
  );
});

Wheel.displayName = 'Wheel';

export function Vehicle() {
  const { controls } = useControls();
  const setSpeed = useStore((state) => state.setSpeed);
  
  const carGltf = useLoader(GLTFLoader, 'https://tuomashatakka.github.io/public/resources/models/vehicles/honda_s2000_gt_ap2/scene.gltf');
  
  const position: [number, number, number] = [0, 2, 0];
  const { radius } = vehicleConfig;

  const chassisRef = useRef<Object3D>(null);
  const [chassisBody, chassisApi] = useBox(
    () => ({
      mass: 150,
      position,
      angularDamping: 0.5,
      args: [vehicleConfig.width, vehicleConfig.height, vehicleConfig.front * 2],
      rotation: [0, Math.PI, 0]
    }),
    chassisRef
  );

  const wheelRefs = [useRef<Object3D>(null), useRef<Object3D>(null), useRef<Object3D>(null), useRef<Object3D>(null)];
  const wheelBodies = [useRef<Object3D>(null), useRef<Object3D>(null), useRef<Object3D>(null), useRef<Object3D>(null)];
  const [_, wheelApi] = useSphere(
    () => ({
      mass: 1,
      type: 'Kinematic',
      collisionFilterGroup: 0,
      args: [radius],
    }),
    wheelBodies[0]
  );
  useSphere(() => ({ mass: 1, type: 'Kinematic', collisionFilterGroup: 0, args: [radius] }), wheelBodies[1]);
  useSphere(() => ({ mass: 1, type: 'Kinematic', collisionFilterGroup: 0, args: [radius] }), wheelBodies[2]);
  useSphere(() => ({ mass: 1, type: 'Kinematic', collisionFilterGroup: 0, args: [radius] }), wheelBodies[3]);

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
      carGltf.scene.rotation.y = Math.PI;
    }
  }, [carGltf]);
  
  const velocity = useRef(new Vector3());
  
  useEffect(() => {
    if (chassisApi) {
        const unsubscribe = chassisApi.velocity.subscribe((v) => velocity.current.fromArray(v));
        return unsubscribe;
    }
  }, [chassisApi]);

  useFrame((state, delta) => {
    if (!vehicle.current || !vehicleApi) return;

    const { force, steer, maxBrake } = vehicleConfig;

    const engineForce = controls.forward ? -force : controls.backward ? force / 2 : 0;
    vehicleApi.applyEngineForce(engineForce, 2);
    vehicleApi.applyEngineForce(engineForce, 3);
    
    const steerValue = controls.left ? steer : controls.right ? -steer : 0;
    vehicleApi.setSteeringValue(steerValue, 0);
    vehicleApi.setSteeringValue(steerValue, 1);

    const brakeForce = controls.brake ? maxBrake : 0;
    vehicleApi.setBrake(brakeForce, 0);
    vehicleApi.setBrake(brakeForce, 1);
    vehicleApi.setBrake(brakeForce, 2);
    vehicleApi.setBrake(brakeForce, 3);

    if (controls.reset) {
      chassisApi.position.set(0, 2, 0);
      chassisApi.velocity.set(0, 0, 0);
      chassisApi.angularVelocity.set(0, 0, 0);
      chassisApi.rotation.set(0, Math.PI, 0);
    }
    
    setSpeed(velocity.current.length());

    const vehiclePosition = new Vector3();
    const vehicleQuaternion = new Quaternion();
    vehicle.current.getWorldPosition(vehiclePosition);
    vehicle.current.getWorldQuaternion(vehicleQuaternion);

    const cameraOffset = new Vector3(0, 4.5, 9);
    cameraOffset.applyQuaternion(vehicleQuaternion);
    cameraOffset.add(vehiclePosition);

    state.camera.position.lerp(cameraOffset, delta * 4);
    state.camera.lookAt(vehiclePosition);
  });

  return (
    <group ref={vehicle as React.Ref<Group>}>
      <group ref={chassisRef}>
        <primitive object={carGltf.scene} position={[0, -0.5, 0]}/>
      </group>
      <Wheel ref={wheelRefs[0]} radius={radius} />
      <Wheel ref={wheelRefs[1]} radius={radius} />
      <Wheel ref={wheelRefs[2]} radius={radius} />
      <Wheel ref={wheelRefs[3]} radius={radius} />
    </group>
  );
}
