'use client'

import { use, useCallback } from 'react'
import { SceneCanvas } from '@/components/scene-canvas'
import { GameUI } from '@/components/aftertouch-control-panel'
import { mountRace } from '@/engine/scenes/race'
import type { LevelId } from '@/engine/levels/types'

/** The race. One canvas driven by the vanilla engine, with the HUD over it. */
type RacePageProps = { params: Promise<{ level: string }> }

export default function RacePage ({ params }: RacePageProps) {
  const { level } = use(params)

  const mount = useCallback(
    (canvas: HTMLCanvasElement) => mountRace(canvas, level as LevelId),
    [ level ]
  )

  return <main className="h-screen w-full bg-background">
    <SceneCanvas mount={ mount } />
    <GameUI />
  </main>
}
