"use client";

import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { useShipStore } from '@/hooks/use-ship-store';
import { SHIP_PRESETS, applyShipConfig } from '@/lib/ship/materials';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export function HangarScene() {
  const { currentConfig, selectShip } = useShipStore();

  const gltf = useGLTF(SHIP_PRESETS[currentConfig.shipId].path);
  const modelRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (modelRef.current) {
      applyShipConfig(modelRef.current, currentConfig);
    }
  }, [gltf, currentConfig]);

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

      <primitive
        ref={modelRef}
        object={gltf.scene}
        scale={1.2}
        position={[0, -1.5, 0]}
      />

      <mesh position={[0, -3.5, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 20]} />
        <meshStandardMaterial color="#1a1a2e" metalness={0.3} roughness={0.7} />
      </mesh>
    </group>
  );
}

useGLTF.preload('/icaras/scene.gltf');
useGLTF.preload('/spaceship_-_cb1/scene.gltf');