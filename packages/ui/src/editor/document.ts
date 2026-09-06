import { BATTLE_TEAMS } from 'Ψarena'
import type { BattleTeam, RampSide } from 'Ψarena'


/**
 * What the editor edits.
 *
 * The document is deliberately NOT a `TrackSpec` or a `BattleArena`. Those two
 * carry derived bulk — thousands of box colliders, a sampled centreline, gate
 * transforms — that no one should be dragging around a UI or writing to a file.
 * The document is the small authored input; `compile.ts` turns it into the real
 * runtime types, and it is the ONLY thing that does, so the editor cannot show
 * you a track the game would build differently.
 *
 * It is also plain JSON with no class, no `Vector3` and no function on it, so
 * export, import, undo and the React state are all the same value.
 *
 * The previous editor had none of this: it authored a 12×12 isometric grid of
 * integers against a `Point` type of its own invention, exported a JSON shape
 * nothing in the repository read, and had no path to a playable level at all.
 * Every dimension below is in WORLD METRES, matching what the tracks in
 * `Λlevels` are actually built from.
 */

export const DOCUMENT_VERSION = 2

export type MapKind = 'race' | 'battle'

/** Sky, fog and bloom — the fields both `TrackSpec` and `BattleArena` carry. */
export type MapEnvironment = {
  background: string;

  /** `[colour, near, far]`, exactly as the runtime specs want it. */
  fogColor: string;
  fogNear:  number;
  fogFar:   number;

  bloomStrength:  number;
  bloomThreshold: number;
  bloomRadius:    number;
}

/**
 * One control point on the racing line.
 *
 * `width` is per-node and interpolated by the compiler, which is what the old
 * editor's inspector *claimed* to do ("evenly tweened along each segment") while
 * exporting a single number the ribbon builder could not vary. Now the taper is
 * real.
 */
export type RouteNode = {
  id:    string;
  x:     number;
  y:     number;
  z:     number;
  width: number;

  /**
   * Extra banking at this node, in degrees, on top of the curvature-driven bank
   * the ribbon builder applies. Signed: positive rolls the deck toward +x.
   */
  bank: number;
}

export type RaceDocument = {
  nodes: RouteNode[];

  /** Closed circuit vs. one-run sprint. Drives `TrackSpec.loop`. */
  loop: boolean;
  laps: number;

  /** Ribbon samples per span. Higher is smoother and more colliders. */
  segments: number;

  /** Curvature-driven bank ceiling, radians, fed straight to `buildTrack`. */
  banking: number;
}

export type PlateauItem = {
  id:      string;
  name:    string;
  short:   string;
  centreX: number;
  centreZ: number;
  halfX:   number;
  halfZ:   number;
  height:  number;
  ramps:   RampSide[];
}

export type ZoneItem = {
  id:     string;
  name:   string;
  short:  string;
  x:      number;
  y:      number;
  z:      number;
  radius: number;
}

export type SpawnItem = {
  id:   string;
  team: BattleTeam;
  x:    number;
  z:    number;

  /** Facing, degrees about +y. Compiled into the spawn quaternion. */
  yaw: number;
}

export type BaseItem = {
  team: BattleTeam;
  x:    number;
  y:    number;
  z:    number;
}

export type BattleDocument = {

  /** Deck half-extent. The perimeter wall stands just inside it. */
  half:   number;
  floorY: number;

  plateaus: PlateauItem[];
  zones:    ZoneItem[];
  spawns:   SpawnItem[];
  bases:    BaseItem[];

  captureTime:    number;
  contestDrain:   number;
  zonePeriod:     number;
  flagReturnTime: number;
}

export type EditorDocument = {
  version: typeof DOCUMENT_VERSION;
  kind:    MapKind;
  id:      string;
  name:    string;
  tagline: string;

  environment: MapEnvironment;
  race:        RaceDocument;
  battle:      BattleDocument;
}

/** Stable ids without a `Date.now()` collision the moment two land in one tick. */
let counter = 0

export function nextId (prefix: string): string {
  counter += 1
  return `${prefix}-${counter.toString(36)}`
}

/** Reset the id counter. Tests only — a shared counter makes fixtures order-dependent. */
export function resetIds (): void {
  counter = 0
}

const DEFAULT_ENVIRONMENT: MapEnvironment = {
  background:     '#0d1120',
  fogColor:       '#0d1120',
  fogNear:        140,
  fogFar:         900,
  bloomStrength:  0.5,
  bloomThreshold: 0.85,
  bloomRadius:    0.5,
}

/**
 * A starting circuit: a flat colinear straight through the origin, then a loop.
 *
 * The straight is not decoration. Every hand-authored track in `Λlevels` opens
 * with one for the same reason — the grid spawns on it, and a spline that is
 * already curving at the start line banks the deck out from under a ship that
 * has not moved yet.
 */
function defaultRoute (): RouteNode[] {
  const ring: [number, number, number][] = [
    [ 0, 0, 120 ], [ 0, 0, 60 ], [ 0, 0, 0 ], [ 0, 0, -70 ],
    [ 60, 4, -150 ], [ 170, 8, -180 ], [ 240, 5, -110 ],
    [ 250, 2, 20 ], [ 180, 7, 130 ], [ 70, 10, 190 ],
    [ -70, 6, 190 ], [ -180, 2, 120 ], [ -200, 0, 10 ],
    [ -120, 0, -50 ], [ -40, 0, -20 ],
  ]
  return ring.map(([ x, y, z ]) => ({ id: nextId('node'), x, y, z, width: 26, bank: 0 }))
}

function defaultBattle (): BattleDocument {
  const half = 300
  return {
    half,
    floorY:   0,
    plateaus: [
      { id: nextId('mesa'), name: 'Apex Spire', short: 'A', centreX: 0, centreZ: 0, halfX: 82, halfZ: 74, height: 22, ramps: [ '+z', '-z' ]},
      { id: nextId('mesa'), name: 'West Shelf', short: 'W', centreX: -170, centreZ: -90, halfX: 54, halfZ: 48, height: 14, ramps: [ '+x' ]},
      { id: nextId('mesa'), name: 'East Shelf', short: 'E', centreX: 170, centreZ: 90, halfX: 54, halfZ: 48, height: 14, ramps: [ '-x' ]},
    ],
    zones: [
      { id: nextId('zone'), name: 'Apex', short: 'A', x: 0, y: 22, z: 0, radius: 34 },
      { id: nextId('zone'), name: 'North Pan', short: 'N', x: 0, y: 0, z: -200, radius: 40 },
      { id: nextId('zone'), name: 'South Pan', short: 'S', x: 0, y: 0, z: 200, radius: 40 },
    ],
    spawns: [
      { id: nextId('spawn'), team: 'red', x: -60, z: -250, yaw: 0 },
      { id: nextId('spawn'), team: 'red', x: 60, z: -250, yaw: 0 },
      { id: nextId('spawn'), team: 'blue', x: -60, z: 250, yaw: 180 },
      { id: nextId('spawn'), team: 'blue', x: 60, z: 250, yaw: 180 },
    ],
    bases: [
      { team: 'red', x: 0, y: 0, z: -270 },
      { team: 'blue', x: 0, y: 0, z: 270 },
    ],
    captureTime:    6,
    contestDrain:   3,
    zonePeriod:     4,
    flagReturnTime: 20,
  }
}

export function createDocument (kind: MapKind = 'race'): EditorDocument {
  return {
    version:     DOCUMENT_VERSION,
    kind,
    id:          kind === 'race' ? 'custom-circuit' : 'custom-arena',
    name:        kind === 'race' ? 'Custom Circuit' : 'Custom Arena',
    tagline:     'Authored in the map forge.',
    environment: { ...DEFAULT_ENVIRONMENT },
    race:        { nodes: defaultRoute(), loop: true, laps: 3, segments: 16, banking: 0.4 },
    battle:      defaultBattle(),
  }
}

/**
 * Coerce an unknown parse into a document, filling every gap from factory.
 *
 * Import is the one place a malformed value reaches the reducer, and a missing
 * `race.nodes` there is a blank screen with a stack trace behind it. Anything
 * unrecognised is dropped rather than trusted.
 */
export function normaliseDocument (input: unknown): EditorDocument {
  const base = createDocument('race')
  if (!input || typeof input !== 'object')
    return base

  const raw   = input as Partial<EditorDocument>
  const nodes = Array.isArray(raw.race?.nodes) ? raw.race.nodes.filter(isRouteNode) : []

  return {
    version:     DOCUMENT_VERSION,
    kind:        raw.kind === 'battle' ? 'battle' : 'race',
    id:          text(raw.id, base.id),
    name:        text(raw.name, base.name),
    tagline:     typeof raw.tagline === 'string' ? raw.tagline : base.tagline,
    environment: { ...base.environment, ...raw.environment },
    race:        { ...base.race, ...raw.race, nodes: nodes.length >= 2 ? nodes : base.race.nodes },
    battle:      normaliseBattle(raw.battle, base.battle),
  }
}

const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value ? value : fallback

function normaliseBattle (raw: Partial<BattleDocument> | undefined, base: BattleDocument): BattleDocument {
  return {
    ...base,
    ...raw,
    plateaus: Array.isArray(raw?.plateaus) ? raw.plateaus : base.plateaus,
    zones:    Array.isArray(raw?.zones) ? raw.zones : base.zones,
    spawns:   Array.isArray(raw?.spawns) ? raw.spawns : base.spawns,
    // One base per team, always — the arena compiler indexes them by name and a
    // missing side would put the blue objective at the origin without saying so.
    bases:    BATTLE_TEAMS.map(team =>
      raw?.bases?.find(b => b.team === team) ?? base.bases.find(b => b.team === team)!),
  }
}

function isRouteNode (value: unknown): value is RouteNode {
  const node = value as RouteNode
  return Boolean(node) &&
    Number.isFinite(node.x) && Number.isFinite(node.y) && Number.isFinite(node.z) &&
    Number.isFinite(node.width)
}
