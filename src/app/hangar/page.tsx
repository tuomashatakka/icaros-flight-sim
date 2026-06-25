"use client";

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { HangarControls } from '@/components/hangar/hangar-controls';
import { HangarScene } from '@/components/hangar/hangar-scene';

export default function HangarPage() {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background">
      <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-background to-cyan-900/20" />
      
      <div className="relative z-10 flex h-screen flex-col lg:flex-row">
        <div className="flex-1">
          <Canvas
            camera={{ position: [0, 5, 15], fov: 45 }}
            shadows
          >
            <fog attach="fog" args={['#171720', 20, 100]} />
            <ambientLight intensity={0.5} />
            <HangarScene />
            <OrbitControls
              enablePan={true}
              enableZoom={true}
              enableRotate={true}
              autoRotate={false}
              minDistance={3}
              maxDistance={15}
            />
            <EffectComposer>
              <Bloom luminanceThreshold={0.5} luminanceSmoothing={0.9} intensity={1.2} />
            </EffectComposer>
          </Canvas>
        </div>
        
        <div className="w-full lg:w-96">
          <HangarControls />
        </div>
      </div>
    </div>
  );
}