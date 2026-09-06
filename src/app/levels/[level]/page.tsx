'use client'

import { Suspense, use, useCallback, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import { SceneCanvas } from 'Ʊscene-canvas'
import { compileRace } from 'Ʊeditor/compile'
import { DRAFT_LEVEL, readDraft } from 'Ʊeditor/draft-handoff'
import { mountRace } from 'Ɠrace'
import type { TrackId } from 'Λ'
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

  /**
   * `/levels/draft` is the map forge's test drive.
   *
   * The document is compiled HERE, in the tab that is about to drive it, rather
   * than handed over pre-compiled: `compile.ts` is the single source of truth
   * for what a document means, and shipping its output between tabs would let a
   * stale build drive a track the current one would build differently.
   *
   * Compiled once and memoised — a `mount` that changes identity tears the
   * WebGL context down and rebuilds the whole scene.
   */
  const draft = useMemo(() => {
    if (level !== DRAFT_LEVEL)
      return undefined

    const document = readDraft()
    if (!document)
      return undefined

    const compiled = compileRace(document)
    return {
      bundle: {
        spec:     compiled.spec,
        geometry: compiled.geometry,
        curve:    compiled.curve,
        vertices: compiled.vertices,
      },
      props: document.props,
    }
  }, [ level ])

  // `?n=` and `?sv=` are what the lobby hands out, and battle has always read
  // both. Race declared the same options and no caller ever filled them, so a
  // lobby-issued server override silently raced against the default host.
  const mount = useCallback(
    (canvas: HTMLCanvasElement) => mountRace(canvas, level as TrackId, {
      name:        search.get('n') ?? undefined,
      server:      search.get('sv') ?? undefined,
      forcedTouch: search.get('touch'),
      draft,
    }),
    [ level, search, draft ]
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
