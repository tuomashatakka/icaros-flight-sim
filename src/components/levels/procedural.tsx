"use client";

import { usePlane, useBox } from '@react-three/cannon';
import { MeshReflectorMaterial } from '@react-three/drei';
import type { BoxProps, Triplet } from '@react-three/cannon';

function Ground() {
  const [ref] = usePlane(() => ({
    type: 'Static',
    rotation: [-Math.PI / 2, 0, 0],
    material: { friction: 0.01 },
  }));

  return (
    <mesh ref={ref} receiveShadow>
      <planeGeometry args={[500, 500]} />
      <MeshReflectorMaterial
        color="#333"
        blur={[400, 400]}
        resolution={1024}
        mixBlur={1}
        mixStrength={2}
        depthScale={1}
        minDepthThreshold={0.85}
        metalness={0.6}
        roughness={0.6}
      />
    </mesh>
  );
}

type PhysicalBoxProps = BoxProps & {
  args?: Triplet;
  material?: any;
};

function Box({ args = [2, 2, 2], material = { friction: 0.1 }, ...props }: PhysicalBoxProps) {
  const [ref] = useBox(() => ({
    mass: 0, // Make track segments static
    type: 'Static',
    args,
    material,
    ...props,
  }));

  return (
    <mesh ref={ref} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color="hsl(var(--primary))" />
    </mesh>
  );
}


export default function ProceduralTrack() {
  const trackLength = 20;
  const trackWidth = 8;

  return (
    <>
      <Ground />
      {/* Start Platform */}
      <Box position={[0, -0.5, 0]} args={[trackWidth, 1, 20]} />

      {/* Procedural Track Segments */}
      {Array.from({ length: trackLength }).map((_, i) => {
        const z = -(i + 1) * 25;
        const xOffset = (Math.random() - 0.5) * 15;
        const yOffset = Math.random() * 2 - 1;

        // Path segment
        return <Box key={`segment-${i}`} position={[xOffset, -0.5 + yOffset, z]} args={[trackWidth, 1, 20]} />;

      })}
    </>
  );
}
