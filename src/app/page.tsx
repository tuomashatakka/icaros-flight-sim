"use client";

import { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Physics, Debug } from '@react-three/cannon';
import { Sky, Environment } from '@react-three/drei';
import { Vehicle } from '@/components/vehicle-scene';
import { Track } from '@/components/game-hud';
import { GameUI } from '@/components/aftertouch-control-panel';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';

function Buildings() {
  const buildingGeometries = useMemo(() => [
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.BoxGeometry(1, 2, 1),
    new THREE.BoxGeometry(2, 1, 1),
  ], []);

  return (
    <group>
      {Array.from({ length: 100 }).map((_, i) => {
        const x = (Math.random() - 0.5) * 400;
        const z = (Math.random() - 0.5) * 400;

        // Ensure buildings are not on the main track area
        if (Math.abs(x) < 20 && Math.abs(z) < 20) return null;

        const height = Math.random() * 30 + 10;
        const width = Math.random() * 10 + 5;
        const depth = Math.random() * 10 + 5;

        return (
          <mesh key={i} position={[x, height / 2, z]} castShadow>
            <boxGeometry args={[width, height, depth]} />
            <meshStandardMaterial color={Math.random() * 0xffffff} />
          </mesh>
        );
      })}
    </group>
  );
}


export default function Home() {
  return (
    <>
      <Canvas shadows camera={{ position: [0, 5, 15], fov: 50 }}>
        <fog attach="fog" args={['#171720', 20, 200]} />
        <Suspense fallback={null}>
          <ambientLight intensity={0.5} />
          <directionalLight
            position={[10, 10, 5]}
            intensity={1.5}
            castShadow
            shadow-bias={-0.001}
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
            shadow-camera-left={-100}
            shadow-camera-right={100}
            shadow-camera-top={100}
            shadow-camera-bottom={-100}
          />
          <Sky sunPosition={[100, 10, 100]} />
          <Environment preset="night" />
          <Physics
            broadphase="SAP"
            defaultContactMaterial={{
              contactEquationRelaxation: 4,
              friction: 1e-3,
            }}
            allowSleep={false}
            gravity={[0, -9.81, 0]}
          >
            <Debug color="white" scale={1.0001}>
              <Track />
              <Vehicle />
              <Buildings />
            </Debug>
          </Physics>
           <EffectComposer>
            <Bloom luminanceThreshold={0.7} luminanceSmoothing={0.9} height={300} />
          </EffectComposer>
        </Suspense>
      </Canvas>
      <GameUI />
    </>
  );
}
