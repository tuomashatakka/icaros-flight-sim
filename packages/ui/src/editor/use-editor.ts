'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'

import { compileBattle, compileRace, validate } from './compile'
import { deckHeightAt, editorReducer, initialEditorState } from './reducer'
import type { EditorAction, EditorState } from './reducer'
import { frame, INITIAL_CAMERA } from './projection'
import type { Camera } from './projection'
import type { CompiledRace } from './compile'
import type { BattleArena } from 'Ψarena'
import type { Issue } from './compile'
import type { EditorDocument } from './document'


/**
 * Everything the forge does that is not layout.
 *
 * The shell is a component; this is the machine behind it. Keeping the compile
 * memos, the camera, the keyboard map and file IO here means `map-editor.tsx`
 * has no logic to read past its markup — and it means the derived values are
 * computed ONCE and shared, rather than each panel calling the compiler and
 * quietly disagreeing about how long the lap is.
 */
export type Editor = {
  state:    EditorState;
  dispatch: (action: EditorAction) => void;

  camera:    Camera;
  setCamera: (camera: Camera) => void;

  /** Frame the whole map. Bound to `F` and to the Fit button. */
  fit: () => void;

  compiled: CompiledRace | null;
  arena:    BattleArena | null;
  issues:   Issue[];

  /** True while an error-level issue stands. The compile export is gated on it. */
  blocking: boolean;

  /** Place with the active tool, in world metres. */
  place: (x: number, z: number) => void;

  /** Drag whichever item owns `id` to a new plan position. */
  dragItem: (id: string, x: number, z: number) => void;

  exportDocument: () => void;
  exportCompiled: () => void;
  importFile:     (file: File) => Promise<void>;
}

export function useEditor (): Editor {
  const [ state, dispatch ]   = useReducer(editorReducer, undefined, () => initialEditorState('race'))
  const [ camera, setCamera ] = useState<Camera>(INITIAL_CAMERA)

  const { document: doc, tool, team } = state

  const compiled = useMemo(() => doc.kind === 'race' ? compileRace(doc) : null, [ doc ])
  const arena    = useMemo(() => doc.kind === 'battle' ? compileBattle(doc) : null, [ doc ])
  const issues   = useMemo(() => validate(doc), [ doc ])

  const fit = useCallback(() => {
    setCamera(frame(doc.kind === 'race'
      ? doc.race.nodes
      : [{ x: -doc.battle.half, z: -doc.battle.half }, { x: doc.battle.half, z: doc.battle.half }]))
  }, [ doc ])

  useFrameOnKindChange(doc.kind, fit)
  useShortcuts(state.selected, dispatch, fit)

  const place = useCallback((x: number, z: number) => {
    if (tool === 'route')
      dispatch({ type: 'node.add', x, z })
    else if (tool === 'plateau')
      dispatch({ type: 'plateau.add', x, z })
    else if (tool === 'zone')
      dispatch({ type: 'zone.add', x, z })
    else if (tool === 'spawn')
      dispatch({ type: 'spawn.add', x, z, team })
  }, [ tool, team ])

  const dragItem = useCallback((id: string, x: number, z: number) => {
    if (doc.kind === 'race')
      dispatch({ type: 'node.patch', id, patch: { x, z }})
    else if (doc.battle.plateaus.some(p => p.id === id))
      dispatch({ type: 'plateau.patch', id, patch: { centreX: x, centreZ: z }})
    else if (doc.battle.zones.some(zone => zone.id === id))
      dispatch({ type: 'zone.patch', id, patch: { x, z, y: deckHeightAt(doc.battle, x, z) }})
    else if (doc.battle.spawns.some(s => s.id === id))
      dispatch({ type: 'spawn.patch', id, patch: { x, z }})
    else if (id.startsWith('base-'))
      dispatch({ type: 'base.patch', team: id.endsWith('red') ? 'red' : 'blue', patch: { x, z }})
  }, [ doc ])

  return {
    state,
    dispatch,
    camera,
    setCamera,
    fit,
    compiled,
    arena,
    issues,
    blocking:       issues.some(issue => issue.level === 'error'),
    place,
    dragItem,
    exportDocument: () => download(doc, `${doc.id}.forge.json`),
    exportCompiled: () => download(
      doc.kind === 'race' ? compiled?.spec : arena,
      `${doc.id}.${doc.kind === 'race' ? 'track' : 'arena'}.json`
    ),
    importFile: async (file: File) => {
      try {
        dispatch({ type: 'load', document: JSON.parse(await file.text()) })
      }
      catch {
        // A malformed file is a user mistake, not a crash. `normaliseDocument`
        // covers a valid parse of the wrong shape; this covers the rest, and
        // loading `null` gives back a clean factory document.
        dispatch({ type: 'load', document: null })
      }
    },
  }
}

/**
 * Refit when the map KIND changes, and only then.
 *
 * Guarded on a ref rather than a trimmed dependency list: `fit` closes over the
 * document, so it changes identity on every edit and a naive effect would
 * re-frame the view out from under a drag.
 */
function useFrameOnKindChange (kind: EditorDocument['kind'], fit: () => void): void {
  const framed = useRef(kind)
  useEffect(() => {
    if (framed.current === kind)
      return
    framed.current = kind
    fit()
  }, [ kind, fit ])
}

/** Undo/redo, delete and frame. Ignored while a form control has focus. */
function useShortcuts (selected: string | null, dispatch: (action: EditorAction) => void, fit: () => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/).test(target.tagName))
        return

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' })
      }
      else if ((event.key === 'Backspace' || event.key === 'Delete') && selected) {
        event.preventDefault()
        dispatch({ type: 'remove', id: selected })
      }
      else if (event.key === 'f')
        fit()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ selected, dispatch, fit ])
}

function download (payload: unknown, filename: string): void {
  if (!payload)
    return

  const link    = window.document.createElement('a')
  link.href     = URL.createObjectURL(new Blob([ JSON.stringify(payload, null, 2) ], { type: 'application/json' }))
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
