"use client";

import { RigidBody, CuboidCollider } from '@react-three/rapier';
import { useMemo } from 'react';
import * as THREE from 'three';
import { MeshReflectorMaterial, Line, Stars } from '@react-three/drei';
import { buildTrack, ribbonBoxColliders } from '@/lib/track/build-track';
import { RaceManager } from '@/components/race-manager';

/**
 * Orbital Ring — a banked station loop suspended in the starfield. Opens with a
 * FLAT colinear front straight through the origin (so the ship lands on the
 * deck instead of dropping through a hole), then climbs into steeply banked
 * turns high above the planet below.
 */
export default function OrbitalRing() {
  const { geometry, vertices, curve } = useMemo(() => {
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const points = [
      // Flat colinear front straight under the spawn.
      v(0, 0, 60), v(0, 0, 20), v(0, 0, -20), v(0, 0, -60),
      // Climb into the banked far turn.
      v(70, 10, -140), v(180, 18, -180), v(270, 12, -140),
      v(290, 4, -40), v(250, 12, 70), v(150, 18, 120),
      v(50, 10, 100), v(30, 3, 40),
    ];
    return buildTrack({ points, width: 24, segments: 14, closed: true, banking: 0.5 });
  }, []);

  const rail = useMemo(() => curve.getSpacedPoints(460), [curve]);
  const boxColliders = useMemo(() => ribbonBoxColliders(vertices, { stride: 1 }), [vertices]);
  const waypoints = useMemo(
    () => Array.from({ length: 10 }, (_, i) => curve.getPointAt(i / 10)),
    [curve]
  );

  return (
    <>
      <RigidBody type="fixed" colliders={false} position={[0, -0.05, 0]}>
        {boxColliders.map((b, i) => (
          <CuboidCollider key={i} position={b.position} rotation={b.rotation} args={b.args} />
        ))}
        <mesh geometry={geometry} receiveShadow>
          <MeshReflectorMaterial
            color="#1a3040"
            blur={[300, 300]}
            resolution={1024}
            mixBlur={2}
            mixStrength={16}
            depthScale={8}
            minDepthThreshold={0.085}
            metalness={0.5}
            roughness={0.5}
          />
        </mesh>
      </RigidBody>

      <RaceManager waypoints={waypoints} width={24} laps={3} loop />

      {/* Cyan guide rail along the deck centerline. */}
      <Line points={rail} color="#22d3ee" lineWidth={2.5} position={[0, 0.2, 0]} />

      {/* Starfield backdrop + the planet far below. */}
      <Stars radius={500} depth={140} count={6000} factor={7} saturation={0} fade speed={0.5} />
      <mesh position={[0, -320, -40]}>
        <sphereGeometry args={[220, 48, 48]} />
        <meshStandardMaterial color="#13315c" emissive="#0a1a3a" emissiveIntensity={0.5} roughness={1} metalness={0} />
      </mesh>

      {/* Cool-blue station lighting, bright near the start straight. */}
      <hemisphereLight args={['#3b82f6', '#0a0f1e', 0.9]} />
      <pointLight position={[0, 20, 10]} intensity={70} distance={160} color="#67e8f9" />
      <pointLight position={[180, 50, -150]} intensity={260} distance={460} color="#22d3ee" />
      <pointLight position={[250, 40, 60]} intensity={200} distance={420} color="#818cf8" />
      <fog attach="fog" args={['#0a0f1e', 200, 700]} />
    </>
  );
}
