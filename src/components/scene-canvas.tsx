'use client';

import { useEffect, useRef, useState } from 'react';
import type { App } from 'threejs-scene';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- mount fns are generic over their own state shape
export type AnyApp = App<any>;

export type SceneCanvasProps = {
  /**
   * Builds the scene. MUST be referentially stable (a module constant or
   * `useMemo`) — a new identity tears down the WebGL context and rebuilds.
   * That is the intended lever for level changes: `useMemo(() => c =>
   * mountRace(c, level), [level])`.
   */
  mount: (canvas: HTMLCanvasElement) => Promise<AnyApp>;
  /** Runs once the app exists; return a teardown (store bridges live here). */
  onApp?: (app: AnyApp) => (() => void) | void;
  className?: string;
  fallback?: React.ReactNode;
};

/**
 * The only file where React and three.js meet.
 *
 * Two constraints shape it. `attachResizeObserver` sizes the renderer to the
 * canvas *parent*, so the canvas needs its own sized wrapper. And a canvas that
 * has handed out a WebGL context cannot reliably hand out another — which is
 * why the canvas is created imperatively per mount rather than living in JSX,
 * where React would hand back the same element on StrictMode's second mount.
 */
export function SceneCanvas({ mount, onApp, className, fallback }: SceneCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    host.replaceChildren(canvas);

    let app: AnyApp | null = null;
    let detachBridges: (() => void) | void;
    let cancelled = false;

    void (async () => {
      try {
        const built = await mount(canvas);
        // Rapier's WASM init plus FBX loading is slow enough that a fast route
        // change resolves after unmount — without this guard that leaks a whole
        // app and its GPU resources.
        if (cancelled) {
          built.dispose();
          return;
        }
        app = built;
        detachBridges = onApp?.(built);
        built.start();
        setStatus('ready');
      } catch (cause) {
        console.error('[scene] mount failed', cause);
        if (!cancelled) {
          setError(cause instanceof Error ? cause : new Error(String(cause)));
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (typeof detachBridges === 'function') detachBridges();
      app?.dispose();
      app = null;
      canvas.remove();
    };
  }, [mount, onApp]);

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
      {/* Sibling of the canvas host, never a child — `replaceChildren` would wipe it. */}
      {status !== 'ready' && (fallback ?? <SceneFallback status={status} error={error} />)}
    </div>
  );
}

function SceneFallback({ status, error }: { status: 'loading' | 'error'; error: Error | null }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {status === 'loading' ? (
        <p className="animate-pulse font-mono text-sm tracking-widest text-cyan-300/70">
          INITIALISING…
        </p>
      ) : (
        <p className="max-w-md px-6 text-center font-mono text-sm text-rose-400">
          Scene failed to load{error ? `: ${error.message}` : '.'}
        </p>
      )}
    </div>
  );
}
