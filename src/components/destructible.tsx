"use client";

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useBox, useConvexPolyhedron } from '@react-three/cannon';
import { useStore } from '@/hooks/use-store';
import type { Object3D } from 'three';
import { Delaunay } from 'd3-delaunay';
import clipping from 'polygon-clipping';
import type { Triplet } from '@react-three/cannon';
import * as THREE from 'three';

const toVec3 = (arr: Triplet) => new THREE.Vector3(...arr);

function createVoronoiFragments(
  points: THREE.Vector3[],
  size: { width: number; height: number; depth: number }
) {
  const delaunay = Delaunay.from(points.map((p) => [p.x, p.z]));
  const polygons = delaunay.voronoi([
    -size.width / 2,
    -size.depth / 2,
    size.width / 2,
    size.depth / 2,
  ]).cellPolygons();
  return Array.from(polygons).map((polygon) => {
    const convexPolygon = polygon.map(([x, y]) => ({ x, y }));
    const shape = new THREE.Shape(convexPolygon);
    const extrudeSettings = {
      depth: size.height,
      bevelEnabled: false,
    };
    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.translate(0, 0, -size.height / 2);
    geometry.rotateX(Math.PI / 2);

    return geometry;
  });
}

const Fragment = ({ geometry, position, mass = 1 }: { geometry: THREE.BufferGeometry, position: Triplet, mass?: number }) => {
  const [ref, api] = useConvexPolyhedron(() => ({
    mass,
    position,
    args: [geometry as any],
    sleepSpeedLimit: 1.5,
  }));

  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timeout = setTimeout(() => setIsVisible(false), 5000 + Math.random() * 5000);
    return () => clearTimeout(timeout);
  }, []);

  if (!isVisible) return null;

  return (
    <mesh ref={ref as React.Ref<THREE.Mesh>} castShadow receiveShadow geometry={geometry}>
      <meshStandardMaterial color={0xaaaaaa} metalness={0.7} roughness={0.3} />
    </mesh>
  );
};

export const DestructibleBuilding = ({ position, size }: { position: Triplet, size: { width: number, height: number, depth: number } }) => {
  const [isDestroyed, setIsDestroyed] = useState(false);
  const addTakedown = useStore((state) => state.addTakedown);

  const fragments = useMemo(() => {
    const points = Array.from({ length: 50 }, () => new THREE.Vector3(
      (Math.random() - 0.5) * size.width,
      0,
      (Math.random() - 0.5) * size.depth
    ));
    return createVoronoiFragments(points, size);
  }, [size]);

  const onCollide = useCallback((e: { contact: { impactVelocity: number } }) => {
    if (e.contact.impactVelocity > 5) {
      if (!isDestroyed) {
        setIsDestroyed(true);
        addTakedown();
      }
    }
  }, [isDestroyed, addTakedown]);

  const [ref] = useBox(() => ({
    mass: 0,
    position,
    args: [size.width, size.height, size.depth],
    onCollide,
  }));

  if (isDestroyed) {
    return (
      <group>
        {fragments.map((frag, i) => (
          <Fragment key={i} geometry={frag} position={position} />
        ))}
      </group>
    );
  }

  return (
    <mesh ref={ref as React.Ref<THREE.Mesh>} castShadow receiveShadow>
      <boxGeometry args={[size.width, size.height, size.depth]} />
      <meshStandardMaterial color={0x666677} metalness={0.8} roughness={0.2} />
    </mesh>
  );
};
