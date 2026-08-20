'use client'

import { use, useCallback } from 'react'
import { SceneCanvas } from '@/components/scene-canvas'
import { mountRace } from '@/engine/scenes/race'
import type { LevelId } from '@/engine/levels/types'
import styles from './race.module.css'

/** The race. One canvas driven by the vanilla engine, with the HUD over it. */
type RacePageProps = { params: Promise<{ level: string }> }

export default function RacePage ({ params }: RacePageProps) {
  const { level } = use(params)

  const mount = useCallback(
    (canvas: HTMLCanvasElement) => mountRace(canvas, level as LevelId),
    [ level ]
  )

  return <main className={ styles.page }>
    <SceneCanvas mount={ mount } fallback={ false } />
  </main>
}
