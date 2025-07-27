"use client";

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { Physics, Debug } from '@react-three/cannon';
import { Sky, Environment } from '@react-three/drei';
import { Vehicle } from '@/components/vehicle-scene';
import { Track } from '@/components/game-hud';
import { GameUI } from '@/components/aftertouch-control-panel';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { DestructibleBuilding } from '@/components/destructible';

function CityBlocks() {
  const buildingSize = { width: 10, height: 40, depth: 10 };
  const spacing = 20;
  const grid = 5;

  return (
    <group>
      {Array.from({ length: grid }).map((_, i) =>
        Array.from({ length: grid }).map((_, j) => {
          if (i === Math.floor(grid / 2) && j === Math.floor(grid / 2)) return null; // Skip center for open space
          return (
            <DestructibleBuilding
              key={`${i}-${j}`}
              position={[(i - grid / 2) * spacing, buildingSize.height / 2, (j - grid / 2) * spacing]}
              size={buildingSize}
            />
          );
        })
      )}
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
              <CityBlocks />
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
