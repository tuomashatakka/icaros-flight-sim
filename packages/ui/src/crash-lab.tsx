'use client'

import Link from 'next/link'
import { useCallback, useMemo, useRef, useState } from 'react'
import { SceneCanvas } from './scene-canvas'
import type { AnyApp } from './scene-canvas'
import { mountCrashLab } from 'Ɠcrash-lab'
import type { CrashLabHandle, CrashLabState, LaneReport } from 'Ɠcrash-lab'
import styles from './crash-lab.module.css'

/**
 * The crash lab's transport bar.
 *
 * Playback state lives in the scene, not in React. The frame index changes
 * sixty times a second and only the scene reads it — putting it in `useState`
 * would be sixty commits a second for a number nothing in the DOM tree depends
 * on. The scrubber and the counter are written through refs on a rAF instead,
 * the same way the in-game HUD writes its sticks.
 *
 * React owns the things that genuinely change rarely: which toggles are on, and
 * the per-lane check results.
 */
export function CrashLab () {
  const appRef                  = useRef<AnyApp | null>(null)
  const scrubRef                = useRef<HTMLInputElement>(null)
  const readoutRef              = useRef<HTMLSpanElement>(null)
  const [ report, setReport ]   = useState<CrashLabHandle | null>(null)
  const [ playing, setPlaying ] = useState(true)
  const [ toggles, setToggles ] = useState({ showPath: true, showWire: false, showForce: true })

  const mount = useMemo(
    () => (canvas: HTMLCanvasElement) => mountCrashLab(canvas, setReport) as Promise<AnyApp>,
    []
  )

  const patch = useCallback((next: Partial<CrashLabState>) => {
    appRef.current?.setState(next)
  }, [])

  const onApp = useCallback((app: AnyApp) => {
    appRef.current = app

    let raf = 0
    const pump = () => {
      const state = app.getState() as CrashLabState
      if (scrubRef.current && document.activeElement !== scrubRef.current)
        scrubRef.current.value = String(state.frame)
      if (readoutRef.current)
        readoutRef.current.textContent = `${String(state.frame).padStart(4, ' ')}  ·  ${(state.frame / 60).toFixed(2)}s`
      raf = requestAnimationFrame(pump)
    }
    raf = requestAnimationFrame(pump)

    return () => {
      cancelAnimationFrame(raf)
      appRef.current = null
    }
  }, [])

  const step = useCallback((delta: number) => {
    const app = appRef.current
    if (!app || !report)
      return

    const { frame } = app.getState() as CrashLabState
    // Wrap both ways, so stepping back off frame zero lands on the last frame
    // rather than sticking — scrubbing to the end of a run is the common case.
    const next = (frame + delta + report.totalFrames) % report.totalFrames
    app.setState({ frame: next, playing: false })
    setPlaying(false)
  }, [ report ])

  const togglePlay = useCallback(() => {
    const app = appRef.current
    if (!app)
      return

    const next = !(app.getState() as CrashLabState).playing
    app.setState({ playing: next })
    setPlaying(next)
  }, [])

  const flip = useCallback((key: keyof typeof toggles) => {
    setToggles(current => {
      const next = { ...current, [key]: !current[key] }
      appRef.current?.setState({ [key]: next[key] })
      return next
    })
  }, [])

  const failing = report?.lanes.filter(l => l.checks.some(c => !c.ok)) ?? []

  return <div className={ styles.root }>
    <SceneCanvas mount={ mount } onApp={ onApp } className={ styles.canvas } />

    <header className={ styles.header }>
      <Link href="/" className={ styles.back }>&lt; menu</Link>
      <h1 className={ styles.title }>crash lab</h1>

      {report &&
          <span className={ failing.length ? styles.bad : styles.good }>
            {failing.length
              ? `${failing.length} lane${failing.length > 1 ? 's' : ''} failing`
              : `${report.lanes.length} lanes green`}
          </span>
      }
    </header>

    {report &&
        <aside className={ styles.lanes }>
          {report.lanes.map(lane => <LaneCard key={ lane.id } lane={ lane } />)}
        </aside>
    }

    <footer className={ styles.transport }>
      <div className={ styles.buttons }>
        <button type="button" onClick={ () => patch({ frame: 0, playing: false }) } title="rewind to start">|&lt;&lt;</button>
        <button type="button" onClick={ () => step(-10) } title="back ten frames">&lt;&lt;</button>
        <button type="button" onClick={ () => step(-1) } title="back one frame">&lt;</button>

        <button type="button" onClick={ togglePlay } className={ styles.play } title="play / pause">
          {playing ? '||' : '>'}
        </button>

        <button type="button" onClick={ () => step(1) } title="forward one frame">&gt;</button>
        <button type="button" onClick={ () => step(10) } title="forward ten frames">&gt;&gt;</button>

        <button
          type="button"
          onClick={ () => patch({ frame: (report?.totalFrames ?? 1) - 1, playing: false }) }
          title="jump to end">
          &gt;&gt;|
        </button>
      </div>

      <input
        ref={ scrubRef }
        className={ styles.scrub }
        type="range"
        min={ 0 }
        max={ Math.max(0, (report?.totalFrames ?? 1) - 1) }
        defaultValue={ 0 }
        aria-label="playback position"
        onChange={ event => {
          patch({ frame: Number(event.target.value), playing: false })
          setPlaying(false)
        } } />

      <span ref={ readoutRef } className={ styles.readout }>0 · 0.00s</span>

      <div className={ styles.toggles }>
        <Toggle on={ toggles.showForce } onClick={ () => flip('showForce') }>forces</Toggle>
        <Toggle on={ toggles.showPath } onClick={ () => flip('showPath') }>track</Toggle>
        <Toggle on={ toggles.showWire } onClick={ () => flip('showWire') }>wireframe</Toggle>
      </div>
    </footer>
  </div>
}

type ToggleProps = { on: boolean; onClick: () => void; children: React.ReactNode }

function Toggle ({ on, onClick, children }: ToggleProps) {
  return <button type="button" onClick={ onClick } className={ on ? styles.toggleOn : styles.toggleOff }>
    {children}
  </button>
}

type LaneCardProps = { lane: LaneReport }

function LaneCard ({ lane }: LaneCardProps) {
  const failed = lane.checks.filter(c => !c.ok)
  return <details className={ failed.length ? styles.laneBad : styles.laneGood } open={ failed.length > 0 }>
    <summary>
      <span className={ styles.laneId }>{lane.id}</span>
      <span className={ styles.laneMeta }>{failed.length ? `${failed.length} failed` : 'pass'}</span>
    </summary>

    <p className={ styles.laneTitle }>{lane.title}</p>

    <ul>
      {lane.checks.map(check =>
        <li key={ check.label } className={ check.ok ? styles.checkOk : styles.checkBad }>
          {check.ok ? '+' : 'x'} {check.label}
        </li>
      )}
    </ul>

    <p className={ styles.laneHash }>{lane.frames} frames · hash {lane.hash}</p>
  </details>
}
