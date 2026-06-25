"use client";

import { useFrame } from '@react-three/fiber';
import { useShipStore } from '@/hooks/use-ship-store';
import { ShipVisual } from '@/components/ship-visual';
import { useRef } from 'react';
import * as THREE from 'three';

export function HangarScene() {
  const { currentConfig } = useShipStore();
  const modelRef = useRef<THREE.Group>(null);

  useFrame(() => {
    if (modelRef.current) {
      modelRef.current.rotation.y += 0.005;
    }
  });

  return (
    <group>
      <hemisphereLight args={['#ff69b4', '#4a90e2', 0.8]} />
      <directionalLight position={[10, 10, 5]} intensity={1.5} castShadow />
      <pointLight position={[-10, 5, -5]} intensity={0.5} color="#ff00ff" />
      <pointLight position={[0, -10, 0]} intensity={0.3} color="#00ffff" />

      <group ref={modelRef} position={[0, -1.5, 0]}>
        <ShipVisual config={currentConfig} targetSize={4.8} />
      </group>

      <mesh position={[0, -3.5, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#1a1a2e" metalness={0.3} roughness={0.7} />
      </mesh>
    </group>
  );
}
