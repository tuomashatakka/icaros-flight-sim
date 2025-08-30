"use client";

import { useTrimesh } from '@react-three/cannon';
import { useLoader } from '@react-three/fiber';
import { MeshReflectorMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useMemo } from 'react';
import { COLLISION_GROUPS } from '@/lib/utils';

function LoadedTrack() {
  const gltf = useLoader(GLTFLoader, '/spaceship_-_cb1/Untitled.gltf');

  const { vertices, indices, geometry } = useMemo(() => {
    let vertices: Float32Array | undefined;
    let indices: Uint16Array | Uint32Array | undefined;
    let geometry: THREE.BufferGeometry | undefined;

    gltf.scene.traverse((child) => {
      if (child instanceof THREE.Mesh && !geometry) {
        geometry = child.geometry;
        vertices = (child.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
        indices = child.geometry.index!.array as Uint16Array | Uint32Array;
      }
    });
    return { vertices, indices, geometry };
  }, [gltf]);


  const [ref] = useTrimesh(() => ({
    type: 'Static',
    args: [vertices!, indices!],
    collisionFilterGroup: COLLISION_GROUPS.GROUND,
    collisionFilterMask: COLLISION_GROUPS.VEHICLE,
  }), undefined, [vertices, indices]);


  if (!geometry) {
    return null;
  }

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


export default function ProceduralTrack() {
  return (
    <>
      <LoadedTrack />
    </>
  );
}
