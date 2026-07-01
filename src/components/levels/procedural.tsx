
"use client";

import { RigidBody, CuboidCollider } from '@react-three/rapier';
import { useMemo } from 'react';
import * as THREE from 'three';
import { MeshReflectorMaterial } from '@react-three/drei';
import { ribbonBoxColliders, boxColliderFromRing } from '@/lib/track/build-track';
import { RaceManager } from '@/components/race-manager';

export default function ProceduralTrack() {
  const { geometry, vertices, indices, waypoints, mergeBridgeColliders } = useMemo(() => {
    const segmentLength = 20;
    const verts: number[] = [];
    const idxs: number[] = [];
    const centerline: THREE.Vector3[] = [];
    let lastVertexIndex = -1;
    let currentPosition = new THREE.Vector3(-1, 1, 14);
    let currentDirection = new THREE.Vector3(0, 0, -1);

    // `record` collects centerline points for the main racing line only (skips the
    // shortcut + jump), giving the RaceManager an ordered branch-free checkpoint path.
    const addSegment = (length: number, curve: number, ramp: number, width: number, record = false) => {
        const segments = Math.max(1, Math.floor(length / segmentLength));
        for (let i = 0; i < segments; i++) {
            if (record) centerline.push(currentPosition.clone());
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
    addSegment(200, 0, 0, 20, true);

    // --- PATH SPLIT ---
    const splitPosition = currentPosition.clone();
    const splitDirection = currentDirection.clone();
    const splitLastIndex = lastVertexIndex;

    // --- Route 1: Longer, safer curve ---
    addSegment(400, Math.PI / 2, 5, 20, true);
    addSegment(200, 0, 0, 20, true);
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

    // `ribbonBoxColliders` below only bridges array-adjacent rings, but this
    // junction stitches the merge-point ring to two rings that are NOT
    // adjacent in `verts` (Route 1's end and Route 2's end, both captured
    // above before being overwritten). Bridge them explicitly so the
    // drivable surface has a collider everywhere the rendered mesh does.
    const mergeBridgeColliders = [
        boxColliderFromRing(merge1LeftVert, merge1RightVert, leftVertex, rightVertex),
        boxColliderFromRing(lastLeftVert, lastRightVert, leftVertex, rightVertex),
    ].filter((b): b is NonNullable<typeof b> => b !== null);

    // --- Continue after merge ---
    addSegment(500, 0, 0, 20, true);
    addSegment(400, Math.PI / 2, 0, 20, true);
    addSegment(500, 0, -5, 20, true);
    addSegment(400, Math.PI / 2, 0, 20, true);
    addSegment(700, 0, 0, 20, true);
    addSegment(400, Math.PI / 2, 0, 20, true);


    const vertices = new Float32Array(verts);
    const indices = new Uint32Array(idxs);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    
    // Decimate to ~12 evenly-spaced checkpoints along the main racing line.
    const step = Math.max(1, Math.floor(centerline.length / 12));
    const waypoints = centerline.filter((_, i) => i % step === 0);

    return {
        geometry: geo,
        vertices: vertices,
        indices: indices,
        waypoints,
        mergeBridgeColliders,
    };
  }, []);

  // rapier raycast-vehicle wheels hit cuboids, not trimeshes → collide via a box strip.
  const boxColliders = useMemo(
    () => [...ribbonBoxColliders(vertices, { stride: 1 }), ...mergeBridgeColliders],
    [vertices, mergeBridgeColliders]
  );



  return (
    <>
      <RaceManager waypoints={waypoints} width={20} laps={1} loop={false} />
      <RigidBody type="fixed" colliders={false} position={[0, -0.05, 0]}>
      {boxColliders.map((b, i) => (
        <CuboidCollider key={i} position={b.position} rotation={b.rotation} args={b.args} />
      ))}
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
    </>
  );
}
