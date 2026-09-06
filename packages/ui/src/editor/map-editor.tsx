'use client'

import Link from 'next/link'
import { useRef } from 'react'
import { BATTLE_TEAMS } from 'Ψarena'

import { TOOLS } from './reducer'
import { zoomAbout } from './projection'
import { useEditor } from './use-editor'
import { Inspector } from './inspector'
import { Viewport } from './viewport'
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
export function MapEditor () {
  const editor    = useEditor()
  const fileInput = useRef<HTMLInputElement>(null)

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
          className={ styles.primary }
          disabled={ blocking }
          title={ blocking ? 'Fix the errors on the canvas first' : 'Export the compiled runtime spec' }
          onClick={ editor.exportCompiled }>
          Compile { doc.kind === 'race' ? 'TrackSpec' : 'Arena' }
        </button>

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
      <Viewport
        document={ doc }
        compiled={ compiled }
        camera={ camera }
        tool={ tool }
        selected={ selected }
        onCamera={ setCamera }
        onSelect={ id => dispatch({ type: 'select', id }) }
        onPlace={ editor.place }
        onDragItem={ editor.dragItem } />

      <p className={ styles.hint }>
        { activeTool?.hint } Hold Alt to place off-grid · scroll to zoom · F to frame.
      </p>

      <div className={ styles.zoom }>
        <button aria-label="Zoom out" onClick={ () => setCamera(zoomAbout(camera, camera, 1 / 1.3)) }>−</button>
        <output>{ Math.round(camera.scale * 100) }%</output>
        <button aria-label="Zoom in" onClick={ () => setCamera(zoomAbout(camera, camera, 1.3)) }>+</button>
        <button onClick={ editor.fit }>Fit</button>
      </div>

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
