
"use client";

import { RigidBody } from '@react-three/rapier';
import { useMemo } from 'react';
import * as THREE from 'three';
import { MeshReflectorMaterial } from '@react-three/drei';

export default function ProceduralTrack() {
  const { geometry, vertices, indices } = useMemo(() => {
    const segmentLength = 20;
    const verts: number[] = [];
    const idxs: number[] = [];
    let lastVertexIndex = -1;
    let currentPosition = new THREE.Vector3(-1, 1, 1);
    let currentDirection = new THREE.Vector3(0, 0, -1);
    
    const addSegment = (length: number, curve: number, ramp: number, width: number) => {
        const segments = Math.max(1, Math.floor(length / segmentLength));
        for (let i = 0; i < segments; i++) {
            const sideVector = new THREE.Vector3().crossVectors(currentDirection, new THREE.Vector3(0, 1, 0)).normalize();
            const leftVertex = currentPosition.clone().add(sideVector.clone().multiplyScalar(width / 2));
            const rightVertex = currentPosition.clone().add(sideVector.clone().multiplyScalar(-width / 2));

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
    
    const addJump = (length: number, height: number, width: number) => {
        addSegment(length, 0, height, width);
        currentPosition.add(currentDirection.clone().multiplyScalar(length * 1.5));
        lastVertexIndex = -1; // Create a gap
        addSegment(length, 0, -height, width);
    };

    // --- Track Generation ---

    // Start straight
    addSegment(200, 0, 0, 20);

    // --- PATH SPLIT ---
    const splitPosition = currentPosition.clone();
    const splitDirection = currentDirection.clone();
    const splitLastIndex = lastVertexIndex;

    // --- Route 1: Longer, safer curve ---
    addSegment(400, Math.PI / 2, 5, 20);
    addSegment(200, 0, 0, 20);
    const mergePosition1 = currentPosition.clone();
    const mergeDirection1 = currentDirection.clone();
    const mergeIndex1 = lastVertexIndex;

    // --- Reset for Route 2 ---
    currentPosition = splitPosition.clone();
    currentDirection = splitDirection.clone();
    lastVertexIndex = splitLastIndex;

    // --- Route 2: Shorter, riskier shortcut with a jump ---
    addSegment(50, -Math.PI / 8, 0, 10);
    addJump(100, 15, 10); // Narrow jump
    addSegment(50, Math.PI / 8, -5, 10);
    
    // Manual merge connection
    const mergePosition2 = currentPosition.clone();
    
    // Find closest vertices to merge
    const lastLeftVert = new THREE.Vector3(verts[verts.length-6], verts[verts.length-5], verts[verts.length-4]);
    const lastRightVert = new THREE.Vector3(verts[verts.length-3], verts[verts.length-2], verts[verts.length-1]);
    const merge1LeftVert = new THREE.Vector3(verts[mergeIndex1*3 - 3], verts[mergeIndex1*3 - 2], verts[mergeIndex1*3 - 1]);
    const merge1RightVert = new THREE.Vector3(verts[mergeIndex1*3], verts[mergeIndex1*3 + 1], verts[mergeIndex1*3 + 2]);
    
    // Add verts for the merge point
    currentPosition = mergePosition1.clone();
    currentDirection = mergeDirection1.clone();
    lastVertexIndex = mergeIndex1;
    
    const sideVector = new THREE.Vector3().crossVectors(currentDirection, new THREE.Vector3(0, 1, 0)).normalize();
    const leftVertex = currentPosition.clone().add(sideVector.clone().multiplyScalar(20 / 2));
    const rightVertex = currentPosition.clone().add(sideVector.clone().multiplyScalar(-20 / 2));
    
    verts.push(leftVertex.x, leftVertex.y, leftVertex.z);
    verts.push(rightVertex.x, rightVertex.y, rightVertex.z);
    
    const mergePointIndex = lastVertexIndex + 2;

    // Connect shortcut to merge point
    idxs.push(lastVertexIndex - 1, mergePointIndex + 1, lastVertexIndex);
    idxs.push(lastVertexIndex - 1, mergePointIndex, mergePointIndex + 1);


    // Connect main route to merge point
    idxs.push(mergeIndex1, mergeIndex1 + 1, mergePointIndex);
    idxs.push(mergeIndex1 + 1, mergePointIndex + 1, mergePointIndex);
    
    lastVertexIndex = mergePointIndex;

    // --- Continue after merge ---
    addSegment(500, 0, 0, 20);
    addSegment(400, Math.PI / 2, 0, 20);
    addSegment(500, 0, -5, 20);
    addSegment(400, Math.PI / 2, 0, 20);
    addSegment(700, 0, 0, 20);
    addSegment(400, Math.PI / 2, 0, 20);


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



  return (
    <RigidBody type="fixed" colliders="trimesh" position={[0, -0.05, 0]}>
      <mesh geometry={geometry} receiveShadow>
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
    </RigidBody>
  );
}
