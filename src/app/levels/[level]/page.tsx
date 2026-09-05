'use client'

import { Suspense, use, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { SceneCanvas } from '@/components/scene-canvas'
import { mountRace } from '@/engine/scenes/race'
import type { TrackId } from '@crash-velocity/race'
import styles from './race.module.css'

/** The race. One canvas driven by the vanilla engine, with the HUD over it. */
type RacePageProps = { params: Promise<{ level: string }> }

/**
 * The scene, and the route state it needs.
 *
 * `useSearchParams` rather than `window.location.search` inside the engine:
 * the engine mounts on its own schedule, outside the router, so reading the URL
 * from down there reads it at a moment the router makes no promises about. The
 * page owns routing state and hands it down as a prop.
 */
type RaceSceneProps = { level: string }

function RaceScene ({ level }: RaceSceneProps) {
  const search = useSearchParams()
  const touch  = search.get('touch')

  const mount = useCallback(
    (canvas: HTMLCanvasElement) => mountRace(canvas, level as TrackId, { forcedTouch: touch }),
    [ level, touch ]
  )

  return <SceneCanvas mount={ mount } fallback={ false } />
}

export default function RacePage ({ params }: RacePageProps) {
  const { level } = use(params)

  // `useSearchParams` suspends on the server, and the boundary is what keeps
  //  the rest of the route from being dragged into client rendering with it.
  return <main className={ styles.page }>
    <Suspense fallback={ null }>
      <RaceScene level={ level } />
    </Suspense>
  </main>
}
