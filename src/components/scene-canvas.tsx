'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { App } from 'threejs-scene'
import { captureDeviceInfo, collectWebglReport, formatWebglReport } from './webgl-report'
import type { DeviceInfo, WebglReport } from './webgl-report'
import styles from './scene-canvas.module.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mount fns are generic over their own state shape
export type AnyApp = App<any>

/**
 * How many times a lost context is silently rebuilt before the player is told.
 *
 * Exactly one, deliberately. Rebuilding is not free: each attempt asks the
 * browser for another context, and Chrome cuts a page off from WebGL entirely
 * once it has lost too many in a short window. A device reported this happening
 * — the first loss came with a 1x1 probe context still GRANTED, and after three
 * rapid rebuild attempts the same probe came back REFUSED, which is a worse
 * state than the one being recovered from. So: one try, then hand it to the
 * player, whose retry is a deliberate act rather than a loop.
 */
const MAX_AUTO_RECOVERIES = 1

/**
 * How long to wait before that one attempt.
 *
 * A context is usually lost because the device is under pressure right now.
 * Rebuilding into that same moment is what fails; a breath later often works,
 * and costs nothing when it would have succeeded anyway.
 */
const RECOVERY_DELAY_MS = 1200

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
  // What the device said when it gave up. Rendered on screen because the
  // failure only happens on phones, where there is no console to read.
  const [ report, setReport ] = useState<WebglReport | null>(null)
  const recoveries            = useRef(0)

  const retry = useCallback(() => {
    recoveries.current = 0
    setReport(null)
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
    // Stamped when the scene starts drawing, so a context loss can say how long
    // it survived. "Rendered for about a second, then died" is a different bug
    // from "never started", and only this number tells them apart on a device
    // with no console attached.
    let drawingSince = 0
    // Which GPU, which limits, how big the buffer. Read while the context still
    // answers, because a lost one refuses these exact questions.
    let device: DeviceInfo = {}
    let recoveryTimer      = 0
    let detachVisibility: (() => void) | undefined

    // A context lost while playing (tab backgrounded, GPU reset, another page
    // claiming the budget) leaves three rendering into nothing — the scene
    // freezes with no error. Rebuilding on a fresh canvas is the only reliable
    // recovery, since this one's context is gone for good.
    const onContextLost = (event: Event) => {
      event.preventDefault()
      if (cancelled)
        return

      // `statusMessage` is where Chrome puts the driver's own reason.
      const statusMessage = (event as WebGLContextEvent).statusMessage
      const diagnostics   = collectWebglReport('context-lost', app, {
        aliveSeconds: drawingSince ? (performance.now() - drawingSince) / 1000 : undefined,
        statusMessage,
        device,
      })
      console.error('[scene] webgl context lost', diagnostics)
      setReport(diagnostics)

      if (recoveries.current >= MAX_AUTO_RECOVERIES) {
        setError(new Error('the device took the WebGL context away.'))
        setStatus('error')
        return
      }

      recoveries.current += 1
      recoveryTimer = window.setTimeout(() => setAttempt(value => value + 1), RECOVERY_DELAY_MS)
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
        detachVisibility = attachVisibilityLifecycle(built, host)
        drawingSince = performance.now()
        device       = captureDeviceInfo(built)
        setStatus('ready')
      }
      catch (cause) {
        console.error('[scene] mount failed', cause)
        if (!cancelled) {
          const diagnostics = collectWebglReport('create-failed', null, { error: cause })
          console.error('[scene] webgl report', diagnostics)
          setReport(diagnostics)
          setError(cause instanceof Error ? cause : new Error(String(cause)))
          setStatus('error')
        }
      }
    })()

    return () => {
      cancelled = true
      window.clearTimeout(recoveryTimer)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      if (typeof detachBridges === 'function')
        detachBridges()
      detachVisibility?.()
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
    {/* A caller suppressing the loading state (`fallback={false}`) is hiding a
        spinner, not opting out of being told the scene died — so a failure
        always renders the built-in fallback and its diagnostics. */}
    {status === 'loading' && (fallback ?? <SceneFallback status={ status } error={ error } report={ report } onRetry={ retry } />)}
    {status === 'error' && <SceneFallback status={ status } error={ error } report={ report } onRetry={ retry } />}
  </div>
}

/** Hidden canvases spend battery, then resume with a giant visual delta. */
function attachVisibilityLifecycle (app: AnyApp, host: HTMLElement): () => void {
  let intersecting = true

  const sync = () => {
    if (document.visibilityState === 'visible' && intersecting)
      app.start()
    else
      app.stop()
  }
  const observer = typeof IntersectionObserver === 'undefined'
    ? null
    : new IntersectionObserver(entries => {
      intersecting = entries[0]?.isIntersecting ?? true
      sync()
    })

  observer?.observe(host)
  document.addEventListener('visibilitychange', sync)
  return () => {
    observer?.disconnect()
    document.removeEventListener('visibilitychange', sync)
  }
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
  report:   WebglReport | null;
  onRetry?: () => void;
}

function SceneFallback ({ status, error, report, onRetry }: SceneFallbackProps) {
  if (status === 'loading')
    return <div className={ styles.fallback }>
      <p className={ styles.loading }>INITIALISING…</p>
    </div>

  return <div className={ [ styles.fallback, styles.error ].join(' ') }>
    <p>Scene failed to load{error ? `: ${error.message}` : '.'}</p>

    {report && <dl className={ styles.report }>
      {formatWebglReport(report).map(line => <dd key={ line }>{ line }</dd>)}
    </dl>}

    <button type="button" className={ styles.retry } onClick={ onRetry }>Retry</button>
  </div>
}
