"use client";

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useBox, useConvexPolyhedron } from '@react-three/cannon';
import { useStore } from '@/hooks/use-store';
import type { Object3D } from 'three';
import { Delaunay } from 'd3-delaunay';
import clipping from 'polygon-clipping';
import type { Triplet } from '@react-three/cannon';
import * as THREE from 'three';
import { BufferGeometry, Float32BufferAttribute } from 'three';

const toVec3 = (arr: Triplet) => new THREE.Vector3(...arr);

// Utility to convert BufferGeometry to cannon-es convex polyhedron args
const geometryToConvexArgs = (geometry: THREE.BufferGeometry): [number[][], number[][]] => {
    const position = geometry.attributes.position.array;
    const vertices: number[][] = [];
    for (let i = 0; i < position.length; i += 3) {
        vertices.push([position[i], position[i + 1], position[i + 2]]);
    }

    const faces: number[][] = [];
    if (geometry.index) {
        const index = geometry.index.array;
        for (let i = 0; i < index.length; i += 3) {
            faces.push([index[i], index[i + 1], index[i + 2]]);
        }
    } else {
        for (let i = 0; i < vertices.length / 3; i++) {
            faces.push([i * 3, i * 3 + 1, i * 3 + 2]);
        }
    }

    return [vertices, faces];
};


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
    if (!polygon) return null;
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
  }).filter(g => g !== null) as THREE.BufferGeometry[];
}

const Fragment = ({ geometry, position, mass = 1 }: { geometry: THREE.BufferGeometry, position: Triplet, mass?: number }) => {
  const args = useMemo(() => geometryToConvexArgs(geometry), [geometry]);
  
  const [ref] = useConvexPolyhedron(() => ({
    mass,
    position,
    args: args as [THREE.Vector3[], number[][], THREE.Vector3[]],
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
    const points = Array.from({ length: 20 }, () => new THREE.Vector3(
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
          <Fragment key={i} geometry={frag} position={position} mass={5} />
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
