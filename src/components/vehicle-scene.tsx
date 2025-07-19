
"use client"

import { useBox, useRaycastVehicle } from '@react-three/cannon';
import { useFrame, useLoader } from '@react-three/fiber';
import { useEffect, useRef, forwardRef } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useControls } from '@/hooks/use-mobile';
import { useStore } from '@/hooks/use-store';
import { vehicleConfig, wheelInfos } from '@/lib/utils';
import type { Object3D } from 'three';
import { Quaternion, Vector3, Group } from 'three';

const Wheel = forwardRef<Group, { wheelRef: React.RefObject<Object3D> }>(({ wheelRef }, ref) => {
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
    <group ref={wheelRef}>
      <primitive object={wheelGltf.scene.clone()} rotation={[0, -Math.PI / 2, 0]} scale={0.08} />
    </group>
  );
});

Wheel.displayName = 'Wheel';

export function Vehicle() {
  const controls = useControls(state => state.controls);
  const setSpeed = useStore((state) => state.setSpeed);
  
  const carGltf = useLoader(GLTFLoader, 'https://tuomashatakka.github.io/public/resources/models/vehicles/honda_s2000_gt_ap2/scene.gltf');

  const [chassisRef, chassisApi] = useBox(
    () => ({
      mass: 150,
      position: [0, 2, 0],
      angularDamping: 0.5,
      args: [vehicleConfig.width, vehicleConfig.height, vehicleConfig.front * 2]
    }),
    useRef<Object3D>(null)
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
    const unsubscribe = chassisApi.velocity.subscribe((v) => velocity.current.fromArray(v));
    return unsubscribe;
  }, [chassisApi]);

  useFrame((state, delta) => {
    if (!vehicleRef.current || !chassisRef.current || !vehicleApi.wheelInfos) return;

    const { force, steer } = vehicleConfig;

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

    // Update wheel transforms
    for (let i = 0; i < wheelRefs.length; i++) {
        const t = vehicleApi.wheelInfos[i].worldTransform;
        const wheel = wheelRefs[i].current;
        if(wheel) {
            wheel.position.set(t.position.x, t.position.y, t.position.z);
            wheel.quaternion.set(t.quaternion.x, t.quaternion.y, t.quaternion.z, t.quaternion.w);
        }
    }
  });

  return (
    <group ref={vehicleRef as React.Ref<Group>}>
      <group ref={chassisRef as React.Ref<Group>}>
        <primitive object={carGltf.scene} position={[0, -0.5, 0]}/>
      </group>
      <Wheel wheelRef={wheelRefs[0]} />
      <Wheel wheelRef={wheelRefs[1]} />
      <Wheel wheelRef={wheelRefs[2]} />
      <Wheel wheelRef={wheelRefs[3]} />
    </group>
  );
}
