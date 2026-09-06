import { createDocument, nextId, normaliseDocument } from './document'
import type {
  BattleDocument, EditorDocument, MapKind, PlateauItem, RaceDocument, RouteNode, SpawnItem, ZoneItem,
} from './document'
import type { BattleTeam } from 'Ψarena'
import { PROP_CATALOGUE } from 'Ȼprops'
import type { PropKind, PropPlacement } from 'Ȼprops'


/**
 * Every edit the forge can make, as one discriminated union.
 *
 * The whole point of putting this in its own module is that it is PURE: no
 * React, no DOM, no three.js. The old editor kept eight `useState` hooks and
 * mutated them from inside JSX handlers, which is why it had no undo, no
 * multi-select and no way to test that clicking "delete" on the last two nodes
 * left a track that could still be built. Here the state transition is a
 * function of two values and the test suite calls it directly.
 */
export type EditorAction =
  | { type: 'load'; document: unknown } |
  { type: 'kind'; kind: MapKind } |
  { type: 'select'; id: string | null } |
  { type: 'tool'; tool: Tool } |
  { type: 'meta'; patch: Partial<Pick<EditorDocument, 'id' | 'name' | 'tagline'>> } |
  { type: 'environment'; patch: Partial<EditorDocument['environment']> } |
  { type: 'race'; patch: Partial<Omit<RaceDocument, 'nodes'>> } |
  { type: 'battle'; patch: Partial<Omit<BattleDocument, 'plateaus' | 'zones' | 'spawns' | 'bases'>> } |
  { type: 'node.add'; x: number; z: number; after?: string } |
  { type: 'node.patch'; id: string; patch: Partial<RouteNode> } |
  { type: 'node.remove'; id: string } |
  { type: 'node.reverse' } |
  { type: 'plateau.add'; x: number; z: number } |
  { type: 'plateau.patch'; id: string; patch: Partial<PlateauItem> } |
  { type: 'zone.add'; x: number; z: number } |
  { type: 'zone.patch'; id: string; patch: Partial<ZoneItem> } |
  { type: 'spawn.add'; x: number; z: number; team: BattleTeam } |
  { type: 'spawn.patch'; id: string; patch: Partial<SpawnItem> } |
  { type: 'base.patch'; team: BattleTeam; patch: Partial<{ x: number; y: number; z: number }> } |
  { type: 'prop.pick'; kind: PropKind } |
  { type: 'prop.add'; kind: PropKind; x: number; z: number } |
  { type: 'prop.patch'; id: string; patch: Partial<PropPlacement> } |
  { type: 'remove'; id: string } |
  { type: 'undo' } |
  { type: 'redo' }

export type Tool = 'select' | 'route' | 'plateau' | 'zone' | 'spawn' | 'prop'

/** Which tools make sense for which map kind. The toolbar renders this, it does not restate it. */
export const TOOLS: Record<MapKind, { id: Tool; label: string; glyph: string; hint: string }[]> = {
  race: [
    { id: 'select', label: 'Select', glyph: '⌖', hint: 'Drag a node to move it; the inspector edits width, elevation and bank.' },
    { id: 'route', label: 'Route', glyph: '⌁', hint: 'Click the deck to append a control point to the racing line.' },
    { id: 'prop', label: 'Prop', glyph: '❖', hint: 'Pick a prop in the palette, then click to place it. Solid props get colliders.' },
  ],
  battle: [
    { id: 'select', label: 'Select', glyph: '⌖', hint: 'Drag a mesa, zone or spawn; the inspector edits its footprint.' },
    { id: 'plateau', label: 'Mesa', glyph: '▣', hint: 'Click to drop a raised plateau. Ramps are per-face, in the inspector.' },
    { id: 'zone', label: 'Zone', glyph: '◎', hint: 'Click to drop a capture zone.' },
    { id: 'spawn', label: 'Spawn', glyph: '◆', hint: 'Click to drop a spawn point for the active team.' },
    { id: 'prop', label: 'Prop', glyph: '❖', hint: 'Pick a prop in the palette, then click to place it. Solid props get colliders.' },
  ],
}

export type EditorState = {
  document: EditorDocument;
  tool:     Tool;
  selected: string | null;
  team:     BattleTeam;

  /** Which prop the prop tool drops. View state, so it is not undoable. */
  prop: PropKind;

  /** Documents only. Tool and selection are view state and must not be undoable. */
  past:   EditorDocument[];
  future: EditorDocument[];
}

/** Undo depth. Deep enough to walk back a bad corner, shallow enough to stay cheap. */
const HISTORY_LIMIT = 60

export function initialEditorState (kind: MapKind = 'race'): EditorState {
  return { document: createDocument(kind), tool: 'select', selected: null, team: 'red', prop: 'pylon', past: [], future: []}
}

export function editorReducer (state: EditorState, action: EditorAction): EditorState {
  if (action.type === 'undo') {
    const previous = state.past[state.past.length - 1]
    if (!previous)
      return state
    return { ...state, document: previous, past: state.past.slice(0, -1), future: [ state.document, ...state.future ]}
  }

  if (action.type === 'redo') {
    const [ next, ...rest ] = state.future
    if (!next)
      return state
    return { ...state, document: next, past: push(state.past, state.document), future: rest }
  }

  // Cursor moves are handled here rather than in `step`, because they are the
  // two actions that provably cannot touch the document — which is also why
  // they must never push an undo entry.
  if (action.type === 'select')
    return state.selected === action.id ? state : { ...state, selected: action.id }
  if (action.type === 'tool')
    return state.tool === action.tool ? state : { ...state, tool: action.tool }

  // Which prop the palette has armed is view state, exactly like the tool and
  // the selection, so it must not push an undo entry either.
  if (action.type === 'prop.pick')
    return state.prop === action.kind ? state : { ...state, prop: action.kind, tool: 'prop' }

  const next = step(state, action)
  if (next === state)
    return state

  if (next.document === state.document)
    return next

  return { ...next, past: push(state.past, state.document), future: []}
}

function push (history: EditorDocument[], entry: EditorDocument): EditorDocument[] {
  const grown = [ ...history, entry ]
  return grown.length > HISTORY_LIMIT ? grown.slice(grown.length - HISTORY_LIMIT) : grown
}

/**
 * The transition, split three ways.
 *
 * `step` owns the actions that are meaningful in either mode; `raceStep` and
 * `battleStep` own the rest. Splitting on the map kind rather than writing one
 * twenty-case switch is not only a complexity budget — it means a race action
 * can never half-apply to a battle document, which is a class of bug the old
 * editor's shared `selected` integer had.
 */
function step (state: EditorState, action: EditorAction): EditorState {
  if (action.type.startsWith('node.'))
    return raceStep(state, action as RaceAction)
  if (BATTLE_PREFIX.test(action.type))
    return battleStep(state, action as BattleAction)

  const doc = state.document

  switch (action.type) {
    case 'prop.add': {
      const def   = PROP_CATALOGUE[action.kind]
      const added = {
        id:    nextId('prop'),
        kind:  action.kind,
        x:     action.x,
        y:     0,
        z:     action.z,
        yaw:   0,
        scale: 1,
        color: def.color,
      }
      return { ...state, selected: added.id, document: { ...doc, props: [ ...doc.props, added ]}}
    }
    case 'prop.patch':
      return {
        ...state,
        document: { ...doc, props: doc.props.map(prop => prop.id === action.id ? { ...prop, ...action.patch } : prop) },
      }
    case 'load': {
      const loaded = normaliseDocument(action.document)
      return { ...state, document: loaded, selected: null, tool: 'select' }
    }
    case 'kind':
      if (doc.kind === action.kind)
        return state
      return {
        ...state,
        document: { ...doc, kind: action.kind },
        tool:     'select',
        selected: null,
      }
    case 'meta':
      return { ...state, document: { ...doc, ...action.patch }}
    case 'environment':
      return { ...state, document: { ...doc, environment: { ...doc.environment, ...action.patch }}}
    case 'race':
      return { ...state, document: { ...doc, race: { ...doc.race, ...action.patch }}}
    case 'battle':
      return { ...state, document: { ...doc, battle: { ...doc.battle, ...action.patch }}}
    case 'remove':
      return removeStep(state, action.id)
    default:
      return state
  }
}

/** Delete whichever kind of item owns `id`, honouring each collection's floor. */
function removeStep (state: EditorState, id: string): EditorState {
  const doc = state.document

  // Props are the one collection both kinds share, so they are checked before
  // the kind split rather than duplicated on either side of it.
  if (doc.props.some(prop => prop.id === id))
    return { ...state, selected: null, document: { ...doc, props: doc.props.filter(prop => prop.id !== id) }}

  if (doc.kind === 'race')
    return raceStep(state, { type: 'node.remove', id })

  return {
    ...state,
    selected: null,
    document: withBattle(doc, {
      plateaus: doc.battle.plateaus.filter(p => p.id !== id),
      zones:    doc.battle.zones.filter(z => z.id !== id),
      // A team with no spawn cannot enter the match, so its last one stays.
      spawns:   doc.battle.spawns.filter(s =>
        s.id !== id || doc.battle.spawns.filter(o => o.team === s.team).length <= 1),
    }),
  }
}

const BATTLE_PREFIX = /^(plateau|zone|spawn|base)\./

type RaceAction = Extract<EditorAction, { type: `node.${string}` }>
type BattleAction = Extract<EditorAction, { type: `${'plateau' | 'zone' | 'spawn' | 'base'}.${string}` }>

function raceStep (state: EditorState, action: RaceAction): EditorState {
  const doc = state.document

  switch (action.type) {
    case 'node.add': {
      const previous        = doc.race.nodes[doc.race.nodes.length - 1]
      const node: RouteNode = {
        id:    nextId('node'),
        x:     action.x,
        z:     action.z,
        // A new node inherits its neighbour's elevation and width rather than
        // snapping to zero: appending to a climbing section otherwise drops a
        // cliff into the middle of the track.
        y:     previous?.y ?? 0,
        width: previous?.width ?? 26,
        bank:  0,
      }
      const at    = action.after ? doc.race.nodes.findIndex(n => n.id === action.after) : -1
      const nodes = at < 0
        ? [ ...doc.race.nodes, node ]
        : [ ...doc.race.nodes.slice(0, at + 1), node, ...doc.race.nodes.slice(at + 1) ]
      return { ...state, document: withNodes(doc, nodes), selected: node.id }
    }
    case 'node.patch':
      return { ...state, document: withNodes(doc, doc.race.nodes.map(n => n.id === action.id ? { ...n, ...action.patch } : n)) }
    case 'node.remove': {
      // Two points is the floor: a Catmull-Rom through one is not a track, and
      // `buildTrack` emits an empty ribbon rather than complaining.
      if (doc.race.nodes.length <= 2)
        return state

      const nodes = doc.race.nodes.filter(n => n.id !== action.id)
      return { ...state, document: withNodes(doc, nodes), selected: null }
    }
    case 'node.reverse':
      return { ...state, document: withNodes(doc, [ ...doc.race.nodes ].reverse()) }
    default:
      return state
  }
}

function battleStep (state: EditorState, action: BattleAction): EditorState {
  const doc = state.document

  switch (action.type) {
    case 'plateau.add': {
      const plateau: PlateauItem = {
        id:      nextId('mesa'),
        name:    `Mesa ${doc.battle.plateaus.length + 1}`,
        short:   String(doc.battle.plateaus.length + 1),
        centreX: action.x,
        centreZ: action.z,
        halfX:   50,
        halfZ:   50,
        height:  14,
        ramps:   [ '+z' ],
      }
      return { ...state, document: withBattle(doc, { plateaus: [ ...doc.battle.plateaus, plateau ]}), selected: plateau.id }
    }
    case 'plateau.patch':
      return { ...state, document: withBattle(doc, { plateaus: doc.battle.plateaus.map(p => p.id === action.id ? { ...p, ...action.patch } : p) }) }
    case 'zone.add': {
      const zone: ZoneItem = {
        id:     nextId('zone'),
        name:   `Zone ${doc.battle.zones.length + 1}`,
        short:  String.fromCharCode(65 + doc.battle.zones.length),
        x:      action.x,
        y:      deckHeightAt(doc.battle, action.x, action.z),
        z:      action.z,
        radius: 34,
      }
      return { ...state, document: withBattle(doc, { zones: [ ...doc.battle.zones, zone ]}), selected: zone.id }
    }
    case 'zone.patch':
      return { ...state, document: withBattle(doc, { zones: doc.battle.zones.map(z => z.id === action.id ? { ...z, ...action.patch } : z) }) }
    case 'spawn.add': {
      const spawn: SpawnItem = { id: nextId('spawn'), team: action.team, x: action.x, z: action.z, yaw: action.team === 'red' ? 0 : 180 }
      return { ...state, document: withBattle(doc, { spawns: [ ...doc.battle.spawns, spawn ]}), selected: spawn.id }
    }
    case 'spawn.patch':
      return { ...state, document: withBattle(doc, { spawns: doc.battle.spawns.map(s => s.id === action.id ? { ...s, ...action.patch } : s) }) }
    case 'base.patch':
      return { ...state, document: withBattle(doc, { bases: doc.battle.bases.map(b => b.team === action.team ? { ...b, ...action.patch } : b) }) }
    default:
      return state
  }
}

const withNodes = (doc: EditorDocument, nodes: RouteNode[]): EditorDocument =>
  ({ ...doc, race: { ...doc.race, nodes }})

const withBattle = (doc: EditorDocument, patch: Partial<BattleDocument>): EditorDocument =>
  ({ ...doc, battle: { ...doc.battle, ...patch }})

/**
 * Deck height under a point — the tallest plateau covering it, else the floor.
 *
 * A zone dropped on top of a mesa has to sit ON the mesa: at floor height it is
 * buried inside the rock and no ship can ever stand in it.
 */
export function deckHeightAt (battle: BattleDocument, x: number, z: number): number {
  let height = battle.floorY
  for (const p of battle.plateaus)
    if (Math.abs(x - p.centreX) <= p.halfX && Math.abs(z - p.centreZ) <= p.halfZ)
      height = Math.max(height, p.height)
  return height
}
