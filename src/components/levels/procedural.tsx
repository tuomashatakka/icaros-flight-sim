"use client";

import { usePlane } from '@react-three/cannon';
import { MeshReflectorMaterial } from '@react-three/drei';
import { Box, RotatingBox, SwingingHammer } from '@/components/obstacles';

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
        const segment = <Box key={`segment-${i}`} position={[xOffset, -0.5 + yOffset, z]} args={[trackWidth, 1, 20]} />;

        // Obstacles for the segment
        let obstacles = [];
        const obstacleType = Math.random();

        if (obstacleType < 0.3) {
          // Swinging Hammers
          obstacles.push(<SwingingHammer key={`hammer1-${i}`} position={[xOffset - trackWidth / 2 - 2, 5 + yOffset, z]} />);
          obstacles.push(<SwingingHammer key={`hammer2-${i}`} position={[xOffset + trackWidth / 2 + 2, 5 + yOffset, z]} />);
        } else if (obstacleType < 0.6) {
          // Rotating Boxes
          obstacles.push(<RotatingBox key={`rotbox1-${i}`} position={[xOffset, 1.5 + yOffset, z - 5]} args={[trackWidth - 1, 1, 3]} />);
           obstacles.push(<RotatingBox key={`rotbox2-${i}`} position={[xOffset, 1.5 + yOffset, z + 5]} args={[trackWidth - 1, 1, 3]} />);
        } else {
          // Static Boxes as hurdles
           obstacles.push(<Box key={`staticbox1-${i}`} position={[xOffset - 2.5, 0.5 + yOffset, z]} args={[2, 1, 2]} material={{friction: 0.1}}/>);
           obstacles.push(<Box key={`staticbox2-${i}`} position={[xOffset + 2.5, 0.5 + yOffset, z]} args={[2, 1, 2]} material={{friction: 0.1}}/>);
        }

        return [segment, ...obstacles];
      })}
    </>
  );
}
