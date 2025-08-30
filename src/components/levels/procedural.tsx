
"use client";

import { useTrimesh } from '@react-three/cannon';
import { useMemo } from 'react';
import * as THREE from 'three';
import { MeshReflectorMaterial } from '@react-three/drei';
import { COLLISION_GROUPS } from '@/lib/utils';

export default function ProceduralTrack() {
  const { geometry, vertices, indices } = useMemo(() => {
    const outerRadius = 50;
    const innerRadius = 30;
    const segments = 64; // Number of segments for the circle

    const verts = [];
    const idxs = [];

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      // Outer vertex
      verts.push(cos * outerRadius, 0, sin * outerRadius);
      // Inner vertex
      verts.push(cos * innerRadius, 0, sin * innerRadius);

      if (i > 0) {
        const i0 = (i - 1) * 2;
        const i1 = i0 + 1;
        const i2 = i * 2;
        const i3 = i2 + 1;

        // Triangle 1
        idxs.push(i0, i1, i2);
        // Triangle 2
        idxs.push(i1, i3, i2);
      }
    }

    const vertices = new Float32Array(verts);
    const indices = new Uint32Array(idxs);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    
    return { 
        geometry: geo, 
        vertices: vertices,
        indices: indices
    };
  }, []);

  const [ref] = useTrimesh(() => ({
    type: 'Static',
    args: [vertices, indices],
    position: [-50, -0.05, 0],
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
