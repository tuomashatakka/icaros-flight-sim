"use client";

import { Suspense } from 'react';
import { Level } from '@/components/level';
import ProceduralTrack from '@/components/levels/procedural';
import { GameUI } from '@/components/aftertouch-control-panel';
import NeonCanyon from '@/components/levels/neon-canyon';
import OrbitalRing from '@/components/levels/orbital-ring';
import Flats from '@/components/levels/flats';
import { use } from 'react';

const levelComponents: { [key: string]: React.ComponentType } = {
  flats: Flats,
  procedural: ProceduralTrack,
  'neon-canyon': NeonCanyon,
  'orbital-ring': OrbitalRing,
};

export default function LevelPage({ params }: { params: Promise<{ level: string }> }) {
  const { level } = use(params);
  const TrackComponent = levelComponents[level] || ProceduralTrack;

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
