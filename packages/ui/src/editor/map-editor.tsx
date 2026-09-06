'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { BATTLE_TEAMS } from 'Ψarena'
import { propsByCategory } from 'Ȼprops'
import type { PropCategory } from 'Ȼprops'

import { TOOLS } from './reducer'
import { zoomAbout } from './projection'
import { useEditor } from './use-editor'
import { Inspector } from './inspector'
import { Viewport } from './viewport'
import { Viewport3D } from './viewport-3d'
import type { MapKind } from './document'
import styles from './map-editor.module.css'


const KINDS: MapKind[] = [ 'race', 'battle' ]

/**
 * The map forge.
 *
 * A complete rewrite. What it replaced drew a fixed 12×12 isometric grid of
 * integers, edited a `Point` type of its own invention, and exported a JSON
 * body that nothing in the repository could load — the "Test run" button
 * animated a dot along an SVG path.
 *
 * This one authors the REAL model. The document is the small authored input
 * (`document.ts`), every edit is an action through a pure reducer with undo
 * (`reducer.ts`), and `compile.ts` turns it into an actual `TrackSpec` or
 * `BattleArena` through the same `buildTrack` / `plateauColliders` the shipped
 * levels use. The viewport draws the compiled ribbon, so what you see is the
 * deck a room would simulate rather than a bezier that resembles it.
 *
 * This file is layout and nothing else: `use-editor.ts` owns the state machine,
 * the compile memos, the shortcuts and file IO, and every module with a
 * decision in it is testable without a DOM.
 */
const PROP_CATEGORIES: PropCategory[] = [ 'structure', 'hazard', 'dressing' ]

export function MapEditor () {
  const editor    = useEditor()
  const fileInput = useRef<HTMLInputElement>(null)

  // Set when the browser refuses `sessionStorage`, which is a private window
  // with site data blocked. Silently opening a tab onto an empty track is the
  // one outcome worse than saying so.
  const [ storageBlocked, setStorageBlocked ] = useState(false)

  // Plan or perspective. View state and nothing else — the document is the same
  // either way, and so is the compile it is drawn from.
  const [ view, setView ] = useState<'plan' | '3d'>('plan')

  const { state, dispatch, camera, setCamera, compiled, arena, issues, blocking } = editor
  const { document: doc, tool, selected, team }                                   = state
  const activeTool                                                                = TOOLS[doc.kind].find(entry => entry.id === tool)

  return <main className={ styles.editor }>
    <header className={ styles.topbar }>
      <b className={ styles.brand }>MAP FORGE</b>

      <div className={ styles.kinds } role="group" aria-label="Map kind">
        { KINDS.map(kind => <button
          key={ kind }
          aria-pressed={ doc.kind === kind }
          onClick={ () => dispatch({ type: 'kind', kind }) }>
          { kind === 'race' ? 'Circuit' : 'Arena' }
        </button>) }
      </div>

      <div className={ styles.actions }>
        <button disabled={ !state.past.length } onClick={ () => dispatch({ type: 'undo' }) }>Undo</button>
        <button disabled={ !state.future.length } onClick={ () => dispatch({ type: 'redo' }) }>Redo</button>
        <button onClick={ () => fileInput.current?.click() }>Import</button>
        <button onClick={ editor.exportDocument }>Save source</button>

        <button
          disabled={ blocking }
          title={ blocking ? 'Fix the errors on the canvas first' : 'Export the compiled runtime spec' }
          onClick={ editor.exportCompiled }>
          Compile { doc.kind === 'race' ? 'TrackSpec' : 'Arena' }
        </button>

        { doc.kind === 'race' && <button
          className={ styles.primary }
          disabled={ blocking }
          title={ blocking
            ? 'Fix the errors on the canvas first'
            : 'Open this circuit in the real game, in a new tab' }
          onClick={ () => {
            if (!editor.testDrive())
              setStorageBlocked(true)
          } }>
          Test drive
        </button> }

        <Link href="/">Exit</Link>
      </div>

      <input
        ref={ fileInput }
        type="file"
        accept="application/json"
        className={ styles.hiddenInput }
        onChange={ e => {
          const file = e.target.files?.[0]
          if (file)
            void editor.importFile(file)
          e.target.value = ''
        } } />
    </header>

    <nav className={ styles.toolbar } aria-label="Tools">
      { TOOLS[doc.kind].map(entry => <button
        key={ entry.id }
        aria-pressed={ tool === entry.id }
        title={ entry.hint }
        onClick={ () => dispatch({ type: 'tool', tool: entry.id }) }>
        <b>{ entry.glyph }</b>
        <span>{ entry.label }</span>
      </button>) }

      { tool === 'prop' && <div className={ styles.palette } role="group" aria-label="Prop palette">
        { PROP_CATEGORIES.map(category => <fieldset key={ category }>
          <legend>{ category }</legend>

          { propsByCategory(category).map(def => <button
            key={ def.kind }
            aria-pressed={ state.prop === def.kind }
            style={{ '--prop-accent': def.color } as CSSProperties}
            title={ def.half ? 'Solid — gets a collider' : 'Decorative — you drive through it' }
            onClick={ () => dispatch({ type: 'prop.pick', kind: def.kind }) }>
            { def.name }
          </button>) }
        </fieldset>) }
      </div> }

      { doc.kind === 'battle' && <div className={ styles.teamPicker } role="group" aria-label="Spawn team">
        { BATTLE_TEAMS.map(t => <button
          key={ t }
          aria-pressed={ team === t }
          data-team={ t }
          onClick={ () => dispatch({ type: 'spawn.add', x: 0, z: t === 'red' ? -200 : 200, team: t }) }>
          +{ t }
        </button>) }
      </div> }
    </nav>

    <section className={ styles.stage }>
      { view === 'plan'
        ? <Viewport
          document={ doc }
          compiled={ compiled }
          camera={ camera }
          tool={ tool }
          selected={ selected }
          onCamera={ setCamera }
          onSelect={ id => dispatch({ type: 'select', id }) }
          onPlace={ editor.place }
          onDragItem={ editor.dragItem } />
        : <Viewport3D document={ doc } compiled={ compiled } /> }

      <div className={ styles.viewPicker } role="group" aria-label="Viewport">
        <button aria-pressed={ view === 'plan' } onClick={ () => setView('plan') }>Plan</button>
        <button aria-pressed={ view === '3d' } onClick={ () => setView('3d') }>3D</button>
      </div>

      <p className={ styles.hint }>
        { view === 'plan'
          ? `${activeTool?.hint ?? ''} Hold Alt to place off-grid · scroll to zoom · F to frame.`
          : 'Drag to orbit · scroll to dolly. Editing happens in the plan view.' }
      </p>

      <div className={ styles.zoom }>
        <button aria-label="Zoom out" onClick={ () => setCamera(zoomAbout(camera, camera, 1 / 1.3)) }>−</button>
        <output>{ Math.round(camera.scale * 100) }%</output>
        <button aria-label="Zoom in" onClick={ () => setCamera(zoomAbout(camera, camera, 1.3)) }>+</button>
        <button onClick={ editor.fit }>Fit</button>
      </div>

      { storageBlocked && <p className={ styles.hint } role="alert">
        This browser is blocking session storage, so the test drive has nowhere
        to leave the draft. Export the source and load it in the game instead.
      </p> }

      { issues.length > 0 && <ul className={ styles.issues }>
        { issues.map(issue => <li key={ issue.message } data-level={ issue.level }>{ issue.message }</li>) }
      </ul> }
    </section>

    <Inspector
      document={ doc }
      compiled={ compiled }
      arenaColliders={ arena?.colliders.length ?? 0 }
      selected={ selected }
      dispatch={ dispatch } />
  </main>
}
