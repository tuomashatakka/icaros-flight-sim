import * as THREE from 'three';
import { buildTrack, ribbonBoxColliders } from '@/lib/track/build-track';
import { guideRail, pointLight, roadMaterial, starfield } from './shared';
import type { LevelSpec } from './types';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Orbital Ring — a banked station loop suspended in the starfield. Opens with a
 * FLAT colinear front straight through the origin (so the ship lands on the
 * deck instead of dropping through a hole), then climbs into steeply banked
 * turns high above the planet below.
 */
export function orbitalRingLevel(): LevelSpec {
  const { geometry, vertices, curve } = buildTrack({
    points: [
      // Flat colinear front straight under the spawn.
      v(0, 0, 60), v(0, 0, 20), v(0, 0, -20), v(0, 0, -60),
      // Climb into the banked far turn.
      v(70, 10, -140), v(180, 18, -180), v(270, 12, -140),
      v(290, 4, -40), v(250, 12, 70), v(150, 18, 120),
      v(50, 10, 100), v(30, 3, 40),
    ],
    width: 24,
    segments: 14,
    closed: true,
    banking: 0.5,
  });

  return {
    id: 'orbital-ring',
    background: '#0a0f1e',
    fog: ['#0a0f1e', 200, 700],

    waypoints: Array.from({ length: 10 }, (_, i) => curve.getPointAt(i / 10)),
    width: 24,
    laps: 3,
    loop: true,

    colliders: ribbonBoxColliders(vertices, { stride: 1 }),
    colliderOffset: [0, -0.05, 0],

    bloom: { strength: 0.45, threshold: 0.86, radius: 0.5 },

    build(ctx) {
      const road = new THREE.Mesh(geometry, roadMaterial('#1a3040', 0.5, 0.4));
      road.position.y = -0.05;
      road.receiveShadow = true;
      ctx.scene.add(road);

      ctx.scene.add(guideRail(curve.getSpacedPoints(460), '#22d3ee', 0.6, 0.2));

      // Starfield backdrop + the planet far below.
      ctx.scene.add(starfield(ctx.rng));

      const planet = new THREE.Mesh(
        new THREE.SphereGeometry(220, 48, 48),
        new THREE.MeshStandardMaterial({
          color: '#13315c',
          emissive: '#0a1a3a',
          emissiveIntensity: 0.5,
          roughness: 1,
          metalness: 0,
        })
      );
      planet.position.set(0, -320, -40);
      ctx.scene.add(planet);

      ctx.scene.add(new THREE.HemisphereLight('#3b82f6', '#0a0f1e', 0.9));
      ctx.scene.add(pointLight('#67e8f9', 70, 160, [0, 20, 10]));
      ctx.scene.add(pointLight('#22d3ee', 260, 460, [180, 50, -150]));
      ctx.scene.add(pointLight('#818cf8', 200, 420, [250, 40, 60]));

      ctx.scene.fog = new THREE.Fog('#0a0f1e', 200, 700);
    },
  };
}
