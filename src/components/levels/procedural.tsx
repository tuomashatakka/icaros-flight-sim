
"use client";

import { useTrimesh } from '@react-three/cannon';
import { useMemo } from 'react';
import * as THREE from 'three';
import { MeshReflectorMaterial } from '@react-three/drei';
import { COLLISION_GROUPS } from '@/lib/utils';

export default function ProceduralTrack() {
  const { geometry, vertices, indices } = useMemo(() => {
    const trackWidth = 20;
    const segmentLength = 20;
    const verts = [];
    const idxs = [];
    let lastVertexIndex = -1;
    let currentPosition = new THREE.Vector3(0, 0, 0);
    let currentDirection = new THREE.Vector3(0, 0, -1);

    const addSegment = (length: number, curve: number, ramp: number) => {
        const segments = Math.floor(length / segmentLength);
        for (let i = 0; i < segments; i++) {
            const sideVector = new THREE.Vector3().crossVectors(currentDirection, new THREE.Vector3(0, 1, 0)).normalize();
            const leftVertex = currentPosition.clone().add(sideVector.clone().multiplyScalar(trackWidth / 2));
            const rightVertex = currentPosition.clone().add(sideVector.clone().multiplyScalar(-trackWidth / 2));

            verts.push(leftVertex.x, leftVertex.y, leftVertex.z);
            verts.push(rightVertex.x, rightVertex.y, rightVertex.z);
            
            if (lastVertexIndex >= 0) {
                const i0 = lastVertexIndex;
                const i1 = i0 + 1;
                const i2 = i0 + 2;
                const i3 = i2 + 1;

                idxs.push(i0, i1, i2);
                idxs.push(i1, i3, i2);
            }
            lastVertexIndex += 2;

            currentDirection.applyAxisAngle(new THREE.Vector3(0, 1, 0), curve / segments);
            currentPosition.add(currentDirection.clone().multiplyScalar(segmentLength));
            currentPosition.y += ramp / segments;
        }
    };
    
    const addJump = (length: number, height: number) => {
        // Ramp up
        addSegment(length, 0, height);
        // Gap
        currentPosition.add(currentDirection.clone().multiplyScalar(length * 1.5));
        lastVertexIndex = -1; // Reset indices to create a gap
        // Ramp down
        addSegment(length, 0, -height);
    };

    // Build the looped track
    addSegment(500, 0, 0); // Start straight
    addSegment(400, Math.PI / 2, 0); // 90 degree right turn
    addJump(100, 20); // Jump on the next straight
    addSegment(500, 0, 0); // Straight
    addSegment(400, Math.PI / 2, 10); // 90 degree right turn with a ramp up
    addSegment(500, 0, 0); // Next straight
    addSegment(200, -Math.PI / 4, 0); // Chicane left
    addSegment(200, Math.PI / 4, 0); // Chicane right
    addSegment(200, 0, -10); // Straight with ramp down
    addSegment(400, Math.PI / 2, 0); // 90 degree right turn
    addJump(150, 30); // Big jump on the home straight
    addSegment(800, 0, 0); // Home straight
    addSegment(400, Math.PI / 2, 0); // Final 90 degree turn to close the loop

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
    position: [0, -0.05, 0], // Start track just below the car
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
          mixBlur={2}
          mixStrength={20}
          depthScale={10}
          minDepthThreshold={0.085}
          metalness={0.1}
          roughness={0.9}
      />
    </mesh>
  );
}
