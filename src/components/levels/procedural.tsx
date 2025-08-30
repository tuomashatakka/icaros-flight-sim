
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

    const shape = new THREE.Shape();
    shape.moveTo(0, innerRadius);
    shape.absarc(0, 0, innerRadius, 0, Math.PI * 2, false);
    
    const hole = new THREE.Path();
    hole.moveTo(0, outerRadius);
    hole.absarc(0, 0, outerRadius, 0, Math.PI * 2, true);
    shape.holes.push(hole);

    const extrudeSettings = {
      steps: 2,
      depth: 0.1,
      bevelEnabled: false
    };

    let geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geo.rotateX(-Math.PI / 2);

    if (!geo.index) {
        geo = geo.toIndexed();
    }
    
    return { 
        geometry: geo, 
        vertices: geo.attributes.position.array as Float32Array,
        indices: geo.index!.array as Uint16Array | Uint32Array
    };
  }, []);

  const [ref] = useTrimesh(() => ({
    type: 'Static',
    args: [vertices, indices],
    position: [0, -0.05, 0], // Slightly below to avoid z-fighting with car at start
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
