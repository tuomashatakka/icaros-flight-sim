"use client";

import { useTrimesh } from '@react-three/cannon';
import { MeshReflectorMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { COLLISION_GROUPS } from '@/lib/utils';

const radius = 2;
const tube = -1;
const radialSegments = 80;
const tubularSegments = 100;

function TorusTrack() {

  const geometry = new THREE.TorusGeometry(radius, tube, radialSegments, tubularSegments)
  
  const vertices = (geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
  const indices = geometry.index!.array as Uint16Array | Uint32Array;

  const [ref] = useTrimesh(() => ({
    type: 'Kinematic',
    args: [vertices, indices],
    rotation: [-Math.PI / 2, 0, 0],
    position: [radius, -1, 0],
    collisionFilterGroup: COLLISION_GROUPS.VEHICLE,
    collisionFilterMask: COLLISION_GROUPS.GROUND,
  }));

  return (
    <mesh ref={ref} geometry={geometry} receiveShadow>
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
        side={THREE.BackSide} // Render on the inside
      />
    </mesh>
  );
}

export default function ProceduralTrack() {
  return (
    <>
      <TorusTrack />
    </>
  );
}
