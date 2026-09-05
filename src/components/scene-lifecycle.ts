import type { AnyApp } from './scene-canvas'
import { publishSceneLifecycle } from 'Δengine/lifecycle'
import type { SceneLifecycleState } from 'Δengine/lifecycle'


export type LifecycleApp = AnyApp & {
  lifecycleResume?:  () => void;
  setReducedMotion?: (reduced: boolean) => void;
}

type LifecycleOptions = {
  document:            Document;
  window:              Window;
  canvas:              HTMLCanvasElement;
  app:                 LifecycleApp;
  createIntersection?: (callback: IntersectionObserverCallback) => IntersectionObserver;
}

/**
 * Owns browser lifecycle signals without owning the room. Stopping the app
 * removes its rAF subscriber only; Colyseus stays joined and keeps receiving
 * snapshots, matching the existing room policy rather than inventing a second
 * reconnect path for background tabs.
 */
export function attachSceneLifecycle (options: LifecycleOptions): () => void {
  const { document, window, canvas, app } = options
  const motion                            = window.matchMedia('(prefers-reduced-motion: reduce)')
  let hidden    = document.visibilityState === 'hidden'
  let frozen    = false
  let offscreen = false
  let disposed  = false
  let paused    = false

  const commit = () => {
    if (disposed)
      return

    const nextPaused                = hidden || frozen || offscreen
    const next: SceneLifecycleState = {
      hidden,
      frozen,
      offscreen,
      paused:        nextPaused,
      reducedMotion: motion.matches,
    }
    publishSceneLifecycle(next)
    app.setReducedMotion?.(next.reducedMotion)

    if (nextPaused === paused)
      return
    paused = nextPaused
    if (paused)
      app.stop()
    else {
      app.lifecycleResume?.()
      app.start()
    }
  }

  const onVisibility = () => {
    hidden = document.visibilityState === 'hidden'
    commit()
  }
  const onFreeze = () => {
    frozen = true
    commit()
  }
  const onResume = () => {
    frozen = false
    commit()
  }
  const onMotion = () => commit()

  document.addEventListener('visibilitychange', onVisibility)
  document.addEventListener('freeze', onFreeze)
  document.addEventListener('resume', onResume)
  motion.addEventListener('change', onMotion)

  const createIntersection = options.createIntersection ??
    (callback => new IntersectionObserver(callback, { threshold: 0 }))
  const observer = createIntersection(entries => {
    const entry = entries.find(candidate => candidate.target === canvas)
    if (!entry)
      return
    offscreen = !entry.isIntersecting || entry.intersectionRatio <= 0
    commit()
  })
  observer.observe(canvas)
  commit()

  return () => {
    disposed = true
    observer.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
    document.removeEventListener('freeze', onFreeze)
    document.removeEventListener('resume', onResume)
    motion.removeEventListener('change', onMotion)
  }
}
