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
    mass: 0, 
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

function OvalTrack() {
    const trackWidth = 10;
    const straightLength = 100;
    const turnRadius = 40;
    const turnSegments = 60;
    const bankingAngle = Math.PI / 12; // 15 degrees banking

    const straight1Pos: Triplet = [0, -0.5, -(turnRadius + straightLength / 2)];
    const straight2Pos: Triplet = [0, -0.5, turnRadius + straightLength / 2];

    return (
        <>
            {/* Straightaways */}
            <Box position={straight1Pos} args={[trackWidth, 1, straightLength]} />
            <Box position={straight2Pos} args={[trackWidth, 1, straightLength]} />

            {/* Turn 1 (Top) */}
            {Array.from({ length: turnSegments }).map((_, i) => {
                const angle = (i / turnSegments) * Math.PI;
                const x = turnRadius * Math.cos(angle);
                const z = -straightLength / 2 - turnRadius * Math.sin(angle);
                const rotationY = -angle;

                return (
                    <Box 
                        key={`turn1-${i}`}
                        position={[x, -0.5, z]}
                        rotation={[0, rotationY, bankingAngle]}
                        args={[trackWidth, 1, (Math.PI * turnRadius) / turnSegments * 1.1]}
                    />
                )
            })}
            
            {/* Turn 2 (Bottom) */}
             {Array.from({ length: turnSegments }).map((_, i) => {
                const angle = Math.PI + (i / turnSegments) * Math.PI;
                const x = turnRadius * Math.cos(angle);
                const z = straightLength / 2 - turnRadius * Math.sin(angle);
                const rotationY = -angle;
                
                return (
                    <Box 
                        key={`turn2-${i}`}
                        position={[x, -0.5, z]}
                        rotation={[0, rotationY, -bankingAngle]}
                        args={[trackWidth, 1, (Math.PI * turnRadius) / turnSegments * 1.1]}
                    />
                )
            })}
        </>
    );
}


export default function ProceduralTrack() {
  return (
    <>
      <Ground />
      <OvalTrack />
    </>
  );
}
