"use client";

import { RigidBody, CuboidCollider } from '@react-three/rapier';
import { useMemo } from 'react';
import * as THREE from 'three';
import { RaceManager } from '@/components/race-manager';

/**
 * The Flats — a single perfectly flat ground plane (y = 0) used to validate the
 * driving model in isolation: no banking, no gaps, world-up === the ship's up, so
 * steering is pure yaw about Y. An elliptical checkpoint loop sits on the deck and
 * low perimeter walls keep the ship in. Tune handling here before the 3D tracks.
 */
export default function Flats() {
  const HALF = 200; // ground half-extent
  const WALL = 150; // perimeter wall distance from origin

  // Elliptical racing line on the flat deck (y = 0).
  const waypoints = useMemo(() => {
    const rx = 90;
    const rz = 62;
    const n = 16;
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * rx, 0, Math.sin(a) * rz);
    });
  }, []);

  return (
    <>
      <RaceManager waypoints={waypoints} width={18} laps={3} loop />

      {/* Flat ground — one big cuboid so the raycast-vehicle wheels always find it. */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[HALF, 0.5, HALF]} position={[0, -0.5, 0]} />
        {/* Perimeter walls keep the ship on the map. */}
        <CuboidCollider args={[WALL, 3, 1]} position={[0, 3, WALL]} />
        <CuboidCollider args={[WALL, 3, 1]} position={[0, 3, -WALL]} />
        <CuboidCollider args={[1, 3, WALL]} position={[WALL, 3, 0]} />
        <CuboidCollider args={[1, 3, WALL]} position={[-WALL, 3, 0]} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[HALF * 2, HALF * 2]} />
          <meshStandardMaterial color="#15161f" metalness={0.1} roughness={0.95} />
        </mesh>
      </RigidBody>

      {/* Grid so motion + turning read clearly while tuning. */}
      <gridHelper args={[HALF * 2, 80, '#3a3f55', '#23263a']} position={[0, 0.02, 0]} />

      {/* Emissive racing-line markers at each checkpoint. */}
      {waypoints.map((p, i) => (
        <mesh key={i} position={[p.x, 0.05, p.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.6, 2.2, 24]} />
          <meshStandardMaterial
            color={i === 0 ? '#22d3ee' : '#ff2d6f'}
            emissive={i === 0 ? '#22d3ee' : '#ff2d6f'}
            emissiveIntensity={1.4}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      <hemisphereLight args={['#8a9bff', '#0a0c14', 0.7]} />
      <pointLight position={[0, 60, 0]} intensity={120} distance={400} color="#aab4ff" />
    </>
  );
}
