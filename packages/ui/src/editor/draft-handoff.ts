import { normaliseDocument } from './document'
import type { EditorDocument } from './document'


/**
 * How a forged track gets from the editor into the game.
 *
 * `sessionStorage`, and deliberately not a query parameter or a server round
 * trip. A compiled circuit is thousands of colliders and a sampled centreline —
 * far past any URL length worth relying on — and the forge is a client-side
 * tool with no persistence layer behind it, so a POST would mean inventing one
 * to answer a question the browser can already answer.
 *
 * Per-TAB rather than per-origin (`localStorage`) on purpose: a test drive
 * opens a new tab, so the draft belongs to that tab and closing it disposes of
 * the handoff. Two forges open on two maps do not overwrite each other.
 *
 * The document, not the compiled spec: the compiler is the single source of
 * truth for what a document means, and putting its OUTPUT on the wire would let
 * a stale build in one tab drive a track the current one would compile
 * differently — the exact class of bug `compile.ts` exists to prevent.
 */

export const DRAFT_KEY = 'crash-velocity:draft'

/** The level id the race route reads a draft under. */
export const DRAFT_LEVEL = 'draft'

export function storeDraft (document: EditorDocument): boolean {
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(document))
    return true
  }
  catch {
    // Private windows and storage-blocked contexts both throw here. The caller
    // tells the player rather than opening a tab onto an empty track.
    return false
  }
}

export function readDraft (): EditorDocument | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY)
    return raw ? normaliseDocument(JSON.parse(raw)) : null
  }
  catch {
    return null
  }
}
