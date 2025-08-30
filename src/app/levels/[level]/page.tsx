"use client";

import { Suspense } from 'react';
import { Level } from '@/components/level';
import ProceduralTrack from '@/components/levels/procedural';
import { GameUI } from '@/components/aftertouch-control-panel';

const levelComponents: { [key: string]: React.ComponentType } = {
  procedural: ProceduralTrack,
};

export default function LevelPage({ params }: { params: { level: string } }) {
  const TrackComponent = levelComponents[params.level] || ProceduralTrack;

  return (
    <>
      <Level>
        <Suspense fallback={null}>
          <TrackComponent />
        </Suspense>
      </Level>
      <GameUI />
    </>
  );
}
