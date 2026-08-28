'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { App } from 'threejs-scene'
import styles from './scene-canvas.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mount fns are generic over their own state shape
export type AnyApp = App<any>

/**
 * How many times a lost context is silently rebuilt before the player is told.
 * A phone that backgrounds the tab loses its context and gets it straight back,
 * which should be invisible; a device that cannot hold one at all would
 * otherwise remount forever.
 */
const MAX_AUTO_RECOVERIES = 3

export type SceneCanvasProps = {

  /**
   * Builds the scene. MUST be referentially stable (a module constant or
   * `useMemo`) — a new identity tears down the WebGL context and rebuilds.
   * That is the intended lever for level changes: `useMemo(() => c =>
   * mountRace(c, level), [level])`.
   */
  mount: (canvas: HTMLCanvasElement) => Promise<AnyApp>;

  /** Runs once the app exists; return a teardown (store bridges live here). */
  onApp?:     (app: AnyApp) => (() => void) | void;
  className?: string;
  fallback?:  React.ReactNode;
}

/**
 * The only file where React and three.js meet.
 *
 * Three constraints shape it. `attachResizeObserver` sizes the renderer to the
 * canvas *parent*, so the canvas needs its own sized wrapper. A canvas that
 * has handed out a WebGL context cannot reliably hand out another — which is
 * why the canvas is created imperatively per mount rather than living in JSX,
 * where React would hand back the same element on StrictMode's second mount.
 *
 * And the GPU context must be handed back explicitly on the way out. Browsers
 * cap how many live WebGL contexts a page may hold; a desktop cap is high
 * enough that the oldest is quietly recycled, but a phone refuses the next
 * request outright. Since every route change here tears down a scene, a few
 * trips through the hangar were enough to exhaust the budget and leave the
 * player looking at "Error creating WebGL context".
 */
export function SceneCanvas ({ mount, onApp, className, fallback }: SceneCanvasProps) {
  const hostRef               = useRef<HTMLDivElement>(null)
  const [ status, setStatus ] = useState<'loading' | 'ready' | 'error'>('loading')
  const [ error, setError ]   = useState<Error | null>(null)
  // Bumping this rebuilds the scene on a fresh canvas: the retry button, and
  // the automatic recovery when the browser takes the context away.
  const [ attempt, setAttempt ] = useState(0)
  const recoveries              = useRef(0)

  const retry = useCallback(() => {
    recoveries.current = 0
    setAttempt(value => value + 1)
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host)
      return

    setStatus('loading')
    setError(null)

    const canvas         = document.createElement('canvas')
    canvas.style.cssText = 'display:block;width:100%;height:100%'
    canvas.setAttribute('role', 'application')
    canvas.setAttribute('aria-label', 'Crash Velocity interactive game canvas. Keyboard and pointer controls are available in the cockpit HUD.')
    canvas.tabIndex = 0
    host.replaceChildren(canvas)

    let app: AnyApp | null = null
    let detachBridges: (() => void) | void
    let cancelled = false

    // A context lost while playing (tab backgrounded, GPU reset, another page
    // claiming the budget) leaves three rendering into nothing — the scene
    // freezes with no error. Rebuilding on a fresh canvas is the only reliable
    // recovery, since this one's context is gone for good.
    const onContextLost = (event: Event) => {
      event.preventDefault()
      if (cancelled)
        return

      if (recoveries.current >= MAX_AUTO_RECOVERIES) {
        setError(new Error('the WebGL context kept being lost. Close other tabs using 3D graphics, then retry.'))
        setStatus('error')
        return
      }

      recoveries.current += 1
      setAttempt(value => value + 1)
    }

    canvas.addEventListener('webglcontextlost', onContextLost)

    void (async () => {
      try {
        const built = await mount(canvas)
        // Rapier's WASM init plus FBX loading is slow enough that a fast route
        // change resolves after unmount — without this guard that leaks a whole
        // app and its GPU resources.
        if (cancelled) {
          built.dispose()
          releaseContext(built)
          return
        }
        app = built
        detachBridges = onApp?.(built)
        built.start()
        setStatus('ready')
      }
      catch (cause) {
        console.error('[scene] mount failed', cause)
        if (!cancelled) {
          setError(cause instanceof Error ? cause : new Error(String(cause)))
          setStatus('error')
        }
      }
    })()

    return () => {
      cancelled = true
      canvas.removeEventListener('webglcontextlost', onContextLost)
      if (typeof detachBridges === 'function')
        detachBridges()
      if (app) {
        app.dispose()
        releaseContext(app)
      }
      app = null
      canvas.remove()
    }
  }, [ mount, onApp, attempt ])

  return <div className={ [ styles.root, className ].filter(Boolean).join(' ') }>
    <div ref={ hostRef } className={ styles.host } />
    {/* Sibling of the canvas host, never a child — `replaceChildren` would wipe it. */}
    {status !== 'ready' && (fallback ?? <SceneFallback status={ status } error={ error } onRetry={ retry } />)}
  </div>
}

/**
 * Hand the GPU context back rather than waiting for the canvas to be collected.
 *
 * `app.dispose()` releases three's own geometries, materials and textures, but
 * the context itself outlives them until GC gets round to the canvas — which on
 * a route change is far too late to help the scene being built right now.
 * `WEBGL_lose_context`, which `forceContextLoss` wraps, is the only way to
 * release one deterministically.
 */
function releaseContext (app: AnyApp) {
  try {
    app.ctx.renderer.forceContextLoss()
  }
  catch {
    // Throws when the context is already gone, which is the desired end state.
  }
}

type SceneFallbackProps = {
  status:   'loading' | 'error';
  error:    Error | null;
  onRetry?: () => void;
}

function SceneFallback ({ status, error, onRetry }: SceneFallbackProps) {
  if (status === 'loading')
    return <div className={ styles.fallback }>
      <p className={ styles.loading }>INITIALISING…</p>
    </div>

  return <div className={ [ styles.fallback, styles.error ].join(' ') }>
    <p>Scene failed to load{error ? `: ${error.message}` : '.'}</p>
    <button type="button" className={ styles.retry } onClick={ onRetry }>Retry</button>
  </div>
}
