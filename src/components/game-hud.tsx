"use client"
import { usePlane } from '@react-three/cannon';
import { MeshReflectorMaterial } from '@react-three/drei';

export function Track() {
  const [ref] = usePlane(() => ({
    type: 'Static',
    rotation: [-Math.PI / 2, 0, 0],
    material: { friction: 0.01 }
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
