
"use client";

import { useTrimesh } from '@react-three/cannon';
import { useLoader } from '@react-three/fiber';
import { MeshReflectorMaterial } from '@react-three/drei';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { useMemo } from 'react';
import { COLLISION_GROUPS } from '@/lib/utils';

type TrackSegmentProps = {
  gltf: GLTF;
  position: [number, number, number];
  rotation: [number, number, number];
};

function TrackSegment({ gltf, position, rotation }: TrackSegmentProps) {
  const { vertices, indices, geometry } = useMemo(() => {
    let vertices: Float32Array | undefined;
    let indices: Uint16Array | Uint32Array | undefined;
    let geometry: THREE.BufferGeometry | undefined;

    gltf.scene.traverse((child) => {
      if (child instanceof THREE.Mesh && !geometry) {
        geometry = child.geometry.clone(); // Clone to avoid sharing geometry between segments
      }
    });

    if (geometry) {
      vertices = (geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
      indices = geometry.index?.array as Uint16Array | Uint32Array;
    }

    return { vertices, indices, geometry };
  }, [gltf]);

  const [ref] = useTrimesh(() => ({
    type: 'Static',
    args: [vertices!, indices!],
    position,
    rotation,
    collisionFilterGroup: COLLISION_GROUPS.GROUND,
    collisionFilterMask: COLLISION_GROUPS.VEHICLE,
  }), undefined, [vertices, indices, position, rotation]);

  if (!geometry) {
    return null;
  }

  return (
    <group ref={ref}>
        <mesh geometry={geometry} receiveShadow>
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
    </group>
  );
}

export default function ProceduralTrack() {
  const gltf = useLoader(GLTFLoader, '/spaceship_-_cb1/Untitled.gltf');
  
  const segments = useMemo(() => {
    const trackPieces = 8;
    const radius = 60; // Adjust this to change the circle's size
    const segmentLength = 20; // This should be the approximate length of your model to connect them

    return Array.from({ length: trackPieces }).map((_, i) => {
      const angle = (i / trackPieces) * Math.PI * 2;
      
      // We need to calculate the position so the ends of the segments meet.
      // A simple circle won't connect the segments properly if they have length.
      // This part requires a bit of trigonometry to place the segments correctly.
      // For now, a simpler approach might be better. Let's just place them in a circle.
      const position: [number, number, number] = [
        Math.cos(angle) * radius,
        0,
        Math.sin(angle) * radius,
      ];
      
      const rotation: [number, number, number] = [0, -angle, 0];
      
      return { id: i, position, rotation };
    });
  }, []);

  return (
    <>
      {segments.map(({ id, position, rotation }) => (
        <TrackSegment key={id} gltf={gltf} position={position} rotation={rotation} />
      ))}
    </>
  );
}
