"use client";

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/cannon';
import { Sky } from '@react-three/drei';
import { Vehicle } from '@/components/vehicle-scene';
import { Ground } from '@/components/game-hud';
import { GameUI } from '@/components/aftertouch-control-panel';
import { EffectComposer, Bloom } from '@react-three/postprocessing';

export default function Home() {
  return (
    <>
      <Canvas shadows>
        <Suspense fallback={null}>
          <ambientLight intensity={0.5} />
          <directionalLight
            position={[10, 10, 5]}
            intensity={1.5}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
          />
          <Sky sunPosition={[100, 10, 100]} />
          <Physics
            broadphase="SAP"
            gravity={[0, -9.81, 0]}
            defaultContactMaterial={{ friction: 0, restitution: 0.1 }}
          >
            <Ground />
            <Vehicle />
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
