
"use client";

import { useTrimesh } from '@react-three/cannon';
import { useMemo } from 'react';
import * as THREE from 'three';
import { MeshReflectorMaterial } from '@react-three/drei';
import { COLLISION_GROUPS } from '@/lib/utils';

export default function ProceduralTrack() {
  const { geometry, vertices, indices } = useMemo(() => {
    const width = 40;
    const length = 400;
    const widthSegments = 20;
    const lengthSegments = 100;

    const geo = new THREE.PlaneGeometry(width, length, widthSegments, lengthSegments);
    geo.rotateX(-Math.PI / 2);

    const vertices = geo.attributes.position.array as Float32Array;
    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i];
      // Create raised edges and a raised middle part
      const normalizedX = Math.abs(x) / (width / 2); // 0 at center, 1 at edge
      const edgeHeight = Math.pow(normalizedX, 4) * 3; // Sharply rising edges
      const middleHump = (1 - Math.pow(normalizedX * 1.5, 2)) * 0.75; // A gentle hump in the middle
      vertices[i + 1] = edgeHeight + Math.max(0, middleHump); // y-coordinate
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();

    const indices = geo.index!.array as Uint16Array | Uint32Array;

    return { geometry: geo, vertices: vertices.slice(), indices: indices.slice() };
  }, []);

  const [ref] = useTrimesh(() => ({
    type: 'Static',
    args: [vertices, indices],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    collisionFilterGroup: COLLISION_GROUPS.GROUND,
    collisionFilterMask: COLLISION_GROUPS.VEHICLE,
  }), undefined, [vertices, indices]);


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
      />
    </mesh>
  );
}