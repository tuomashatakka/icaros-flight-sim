"use client";

import type { BoxProps, Triplet } from '@react-three/cannon';
import { useBox, useCylinder, useHingeConstraint } from '@react-three/cannon';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Mesh, Object3D } from 'three';

type PhysicalBoxProps = BoxProps & {
  args?: Triplet;
  material?: any;
};

export function Box({ args = [2, 2, 2], material = { friction: 0.1 }, ...props }: PhysicalBoxProps) {
  const [ref] = useBox(() => ({
    mass: 10,
    args,
    material,
    ...props,
  }));

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color="hsl(var(--accent))" />
    </mesh>
  );
}

export function RotatingBox({ args = [2, 2, 2], ...props }: PhysicalBoxProps) {
  const [ref, api] = useBox(() => ({
    mass: 1,
    args,
    type: 'Kinematic',
    ...props,
  }));

  useFrame((state) => {
    const t = state.clock.getElapsedTime();
    api.setRotation(0, t, 0);
  });

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color="hsl(var(--primary))" />
    </mesh>
  );
}

type SwingingHammerProps = {
  position: Triplet;
};

export function SwingingHammer({ position }: SwingingHammerProps) {
  const hammer = useRef<Object3D>(null);
  const [beam] = useCylinder(() => ({
    args: [0.5, 0.5, 5, 8],
    mass: 10,
    position,
  }));
  const [pivot] = useBox(() => ({
    type: 'Static',
    position: [position[0], position[1] + 2.5, position[2]],
    args: [0.5, 0.5, 0.5],
  }));

  useHingeConstraint(pivot, beam, {
    pivotA: [0, 0, 0],
    pivotB: [0, 2.5, 0],
    axisA: [1, 0, 0],
    axisB: [1, 0, 0],
  });

  return (
    <group>
      <mesh ref={hammer as React.Ref<Mesh>} castShadow>
        <cylinderGeometry args={[0.75, 0.75, 2, 12]} />
        <meshStandardMaterial color="hsl(var(--destructive))" />
      </mesh>
       <mesh ref={beam as React.Ref<Mesh>} castShadow>
         <cylinderGeometry args={[0.2, 0.2, 5, 8]} />
         <meshStandardMaterial color="hsl(var(--secondary))" />
       </mesh>
      <mesh ref={pivot as React.Ref<Mesh>} />
    </group>
  );
}
