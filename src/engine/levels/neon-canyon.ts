import * as THREE from 'three';
import { buildTrack, ribbonBoxColliders } from '@/lib/track/build-track';
import { guideRail, pointLight, roadMaterial } from './shared';
import type { LevelSpec } from './types';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Neon Canyon — a winding, banked ravine. The spline opens with a FLAT,
 * colinear straight run along -Z straddling the world origin, so the ship
 * (spawned at [1,2,4]) lands squarely on the road before the track banks and
 * snakes out into the canyon and loops home. Warm-neon lighting + an emissive
 * centerline that bloom turns into a glowing rail.
 */
export function neonCanyonLevel(): LevelSpec {
  const { geometry, vertices, curve } = buildTrack({
    points: [
      // Flat colinear start (zero curvature -> zero bank) under the spawn.
      v(0, 0, 80), v(0, 0, 40), v(0, 0, 0), v(0, 0, -40),
      // Bank out into the canyon.
      v(50, 5, -110), v(140, 9, -130), v(200, 6, -70),
      v(205, 3, 20), v(150, 8, 95), v(60, 11, 140),
      v(-50, 7, 140), v(-150, 2, 80), v(-160, 0, -10),
      v(-90, 0, -50), v(-30, 0, -30),
    ],
    width: 26,
    segments: 16,
    closed: true,
    banking: 0.4,
  });

  return {
    id: 'neon-canyon',
    background: '#1a0a14',
    fog: ['#1a0a14', 140, 620],

    waypoints: Array.from({ length: 10 }, (_, i) => curve.getPointAt(i / 10)),
    width: 26,
    laps: 3,
    loop: true,

    colliders: ribbonBoxColliders(vertices, { stride: 1 }),
    colliderOffset: [0, -0.05, 0],

    bloom: { strength: 0.5, threshold: 0.85, radius: 0.5 },

    build(ctx) {
      const road = new THREE.Mesh(geometry, roadMaterial('#3a1c24', 0.3, 0.6));
      road.position.y = -0.05;
      road.receiveShadow = true;
      ctx.scene.add(road);

      ctx.scene.add(guideRail(curve.getSpacedPoints(420), '#ff2d6f', 0.7, 0.2));

      ctx.scene.add(new THREE.HemisphereLight('#ff6a4d', '#1a0a14', 0.9));
      ctx.scene.add(pointLight('#ff5a7a', 60, 140, [0, 18, 10]));
      ctx.scene.add(pointLight('#ff3b5c', 150, 320, [150, 30, -90]));
      ctx.scene.add(pointLight('#ff8a3d', 150, 320, [190, 30, 20]));
      ctx.scene.add(pointLight('#ff2d6f', 130, 300, [-130, 30, 70]));

      ctx.scene.fog = new THREE.Fog('#1a0a14', 140, 620);
    },
  };
}
