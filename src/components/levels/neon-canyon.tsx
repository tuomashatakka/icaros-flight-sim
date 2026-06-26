"use client";

import { RigidBody, CuboidCollider } from '@react-three/rapier';
import { useMemo } from 'react';
import * as THREE from 'three';
import { MeshReflectorMaterial, Line } from '@react-three/drei';
import { buildTrack, ribbonBoxColliders } from '@/lib/track/build-track';
import { RaceManager } from '@/components/race-manager';

/**
 * Neon Canyon — a winding, banked ravine. The spline opens with a FLAT,
 * colinear straight run along -Z straddling the world origin, so the ship
 * (spawned at [1,2,4]) lands squarely on the road before the track banks and
 * snakes out into the canyon and loops home. Warm-neon lighting + an emissive
 * centerline that Bloom turns into a glowing rail.
 */
export default function NeonCanyon() {
  const { geometry, vertices, curve } = useMemo(() => {
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const points = [
      // Flat colinear start (zero curvature → zero bank) under the spawn.
      v(0, 0, 80), v(0, 0, 40), v(0, 0, 0), v(0, 0, -40),
      // Bank out into the canyon.
      v(50, 5, -110), v(140, 9, -130), v(200, 6, -70),
      v(205, 3, 20), v(150, 8, 95), v(60, 11, 140),
      v(-50, 7, 140), v(-150, 2, 80), v(-160, 0, -10),
      v(-90, 0, -50), v(-30, 0, -30),
    ];
    return buildTrack({ points, width: 26, segments: 16, closed: true, banking: 0.4 });
  }, []);

  const rail = useMemo(() => curve.getSpacedPoints(420), [curve]);
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
            color="#3a1c24"
            blur={[300, 300]}
            resolution={1024}
            mixBlur={2}
            mixStrength={14}
            depthScale={6}
            minDepthThreshold={0.085}
            metalness={0.3}
            roughness={0.7}
          />
        </mesh>
      </RigidBody>

      <RaceManager waypoints={waypoints} width={26} laps={3} loop />

      {/* Glowing centerline — Bloom turns this into a neon stripe. */}
      <Line points={rail} color="#ff2d6f" lineWidth={3} position={[0, 0.2, 0]} />

      {/* Warm-neon canyon lighting, bright near the start so the road reads. */}
      <hemisphereLight args={['#ff6a4d', '#1a0a14', 0.9]} />
      <pointLight position={[0, 18, 10]} intensity={60} distance={140} color="#ff5a7a" />
      <pointLight position={[150, 30, -90]} intensity={150} distance={320} color="#ff3b5c" />
      <pointLight position={[190, 30, 20]} intensity={150} distance={320} color="#ff8a3d" />
      <pointLight position={[-130, 30, 70]} intensity={130} distance={300} color="#ff2d6f" />
      <fog attach="fog" args={['#1a0a14', 140, 620]} />
    </>
  );
}
