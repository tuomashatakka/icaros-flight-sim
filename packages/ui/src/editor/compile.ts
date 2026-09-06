import * as THREE from 'three'
import { buildCheckpoints, buildTrack, ribbonBoxColliders } from 'Λ'
import type { TrackSpec, Vec3Tuple } from 'Λtrack'
import { BATTLE_TEAMS, plateauColliders } from 'Ψarena'
import type { ArenaTransform, BattleArena, BattleTeam, ControlPointDef, PlateauDef } from 'Ψarena'
import type { BoxCollider } from 'Φcolliders'

import type { BattleDocument, EditorDocument, RaceDocument } from './document'


/**
 * The document → runtime compiler.
 *
 * This is the module that makes the forge an editor rather than a diagram. It
 * calls the SAME `buildTrack` / `ribbonBoxColliders` / `plateauColliders` the
 * shipped levels in `Λlevels` and `Ψarena` call, so what the viewport draws and
 * what a room would simulate come from one evaluation, not two that agree until
 * someone nudges a control point.
 *
 * The old editor had no compiler at all: it drew a bezier through screen-space
 * isometric coordinates and exported a JSON body with no colliders, no gates,
 * no fog and no lap count in it. Nothing could load the result, and nothing
 * tried.
 */

export type CompiledRace = {
  spec:     TrackSpec;
  geometry: THREE.BufferGeometry;
  curve:    THREE.CatmullRomCurve3;

  /** Ribbon edges, `[Lx,Ly,Lz, Rx,Ry,Rz, …]` — what the plan view outlines. */
  vertices: Float32Array;

  /** Centreline length in metres, integrated over the sampled curve. */
  length: number;
}

/**
 * Interpolated half-width per ribbon sample.
 *
 * `buildTrack` takes ONE width for the whole ribbon, because every shipped
 * track has one. Per-node width is the editor's addition, so the taper is
 * applied here, afterwards: each sample's two edge vertices are pushed back
 * onto the centreline by the ratio between its node-blended width and the
 * uniform width the ribbon was swept at. Re-sweeping instead would mean a
 * second copy of the banking maths, which is exactly the kind of duplicate that
 * drifts.
 */
function applyWidthTaper (vertices: Float32Array, widths: number[], uniform: number): void {
  const rings = Math.floor(vertices.length / 6)
  const left  = new THREE.Vector3()
  const right = new THREE.Vector3()
  const mid   = new THREE.Vector3()

  for (let i = 0; i < rings; i++) {
    const scale = widths[Math.min(widths.length - 1, Math.round(i / Math.max(rings - 1, 1) * (widths.length - 1)))] / uniform
    if (Math.abs(scale - 1) < 1e-6)
      continue

    const l = i * 6
    const r = l + 3
    left.set(vertices[l], vertices[l + 1], vertices[l + 2])
    right.set(vertices[r], vertices[r + 1], vertices[r + 2])
    mid.addVectors(left, right).multiplyScalar(0.5)

    left.sub(mid).multiplyScalar(scale)
      .add(mid)
    right.sub(mid).multiplyScalar(scale)
      .add(mid)

    vertices[l] = left.x; vertices[l + 1] = left.y; vertices[l + 2] = left.z
    vertices[r]                                                     = right.x; vertices[r + 1] = right.y; vertices[r + 2] = right.z
  }
}

/** Node widths resampled onto the ribbon's sample count, wrapping on a loop. */
function widthProfile (race: RaceDocument, samples: number): number[] {
  const { nodes, loop } = race
  const spans           = loop ? nodes.length : nodes.length - 1

  return Array.from({ length: samples }, (_, i) => {
    const t     = i / Math.max(samples - 1, 1) * spans
    const lower = Math.min(nodes.length - 1, Math.floor(t))
    const upper = loop ? (lower + 1) % nodes.length : Math.min(nodes.length - 1, lower + 1)
    return nodes[lower].width + (nodes[upper].width - nodes[lower].width) * (t - lower)
  })
}

export function compileRace (doc: EditorDocument): CompiledRace {
  const { race, environment } = doc
  const points                = race.nodes.map(n => new THREE.Vector3(n.x, n.y, n.z))

  // The ribbon is swept at the WIDEST node so the taper below only ever pulls
  // edges inward. Sweeping at the mean and pushing some outward would widen the
  // deck past the colliders on any node above average.
  const uniform = Math.max(...race.nodes.map(n => n.width), 1)

  const { geometry, vertices, curve } = buildTrack({
    points,
    width:    uniform,
    segments: race.segments,
    closed:   race.loop,
    banking:  race.banking,
  })

  const rings = Math.floor(vertices.length / 6)
  applyWidthTaper(vertices, widthProfile(race, rings), uniform)
  geometry.getAttribute('position').needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()

  const spec: TrackSpec = {
    id:             doc.id,
    name:           doc.name,
    background:     environment.background,
    fog:            [ environment.fogColor, environment.fogNear, environment.fogFar ],
    waypoints:      race.nodes.map(n => [ n.x, n.y, n.z ] as Vec3Tuple),
    width:          uniform,
    laps:           race.laps,
    loop:           race.loop,
    colliders:      ribbonBoxColliders(vertices, { stride: 1 }),
    colliderOffset: [ 0, -0.05, 0 ],
    bloom:          {
      strength:  environment.bloomStrength,
      threshold: environment.bloomThreshold,
      radius:    environment.bloomRadius,
    },
  }

  return { spec, geometry, curve, vertices, length: curveLength(curve, rings) }
}

function curveLength (curve: THREE.CatmullRomCurve3, samples: number): number {
  let total     = 0
  const a     = new THREE.Vector3()
  const b     = new THREE.Vector3()
  const steps = Math.max(samples, 2)
  curve.getPointAt(0, a)
  for (let i = 1; i <= steps; i++) {
    curve.getPointAt(i / steps, b)
    total += a.distanceTo(b)
    a.copy(b)
  }
  return total
}

const YAW = new THREE.Quaternion()
const UP  = new THREE.Vector3(0, 1, 0)

/** Perimeter wall, four oriented slabs just inside the deck edge. Matches Apex Basin's. */
function perimeter (half: number, floorY: number): BoxCollider[] {
  const thickness = 6
  const height    = 26
  const inner     = half - thickness
  const y         = floorY + height

  return [
    { position: [ 0, y, -inner ], rotation: [ 0, 0, 0 ], args: [ half, height, thickness ]},
    { position: [ 0, y, inner ], rotation: [ 0, 0, 0 ], args: [ half, height, thickness ]},
    { position: [ -inner, y, 0 ], rotation: [ 0, 0, 0 ], args: [ thickness, height, half ]},
    { position: [ inner, y, 0 ], rotation: [ 0, 0, 0 ], args: [ thickness, height, half ]},
  ]
}

const toPlateauDef = (p: BattleDocument['plateaus'][number]): PlateauDef => ({
  id:     p.id,
  name:   p.name,
  short:  p.short,
  centre: [ p.centreX, p.centreZ ],
  half:   [ p.halfX, p.halfZ ],
  height: p.height,
  ramps:  p.ramps,
})

export function compileBattle (doc: EditorDocument): BattleArena {
  const { battle, environment } = doc
  const plateaus                = battle.plateaus.map(toPlateauDef)

  const colliders: BoxCollider[] = [
    // The deck itself: one slab whose TOP face is the drivable floor, sunk by
    // its own half-height for the same reason every ribbon collider is.
    { position: [ 0, battle.floorY - 2, 0 ], rotation: [ 0, 0, 0 ], args: [ battle.half, 2, battle.half ]},
    ...perimeter(battle.half, battle.floorY),
    ...plateaus.flatMap(plateauColliders),
  ]

  const spawnsFor = (team: BattleTeam): ArenaTransform[] =>
    battle.spawns.filter(s => s.team === team).map(s => {
      YAW.setFromAxisAngle(UP, s.yaw * Math.PI / 180)
      return { position: [ s.x, battle.floorY, s.z ] as [number, number, number], quaternion: [ YAW.x, YAW.y, YAW.z, YAW.w ] as [number, number, number, number]}
    })

  const baseOf = (team: BattleTeam) => {
    const found                        = battle.bases.find(b => b.team === team)
    const at: [number, number, number] = found ? [ found.x, found.y, found.z ] : [ 0, battle.floorY, 0 ]
    return { position: at, flagRest: at }
  }

  const controlPoints: ControlPointDef[] = battle.zones.map(z => ({
    id: z.id, name: z.name, short: z.short, position: [ z.x, z.y, z.z ], radius: z.radius,
  }))

  return {
    id:             doc.id,
    name:           doc.name,
    tagline:        doc.tagline,
    background:     environment.background,
    fog:            [ environment.fogColor, environment.fogNear, environment.fogFar ],
    bloom:          { strength: environment.bloomStrength, threshold: environment.bloomThreshold, radius: environment.bloomRadius },
    floorY:         battle.floorY,
    half:           battle.half,
    colliders,
    colliderOffset: [ 0, 0, 0 ],
    plateaus,
    bases:          { red: baseOf('red'), blue: baseOf('blue') },
    spawns:         { red: spawnsFor('red'), blue: spawnsFor('blue') },
    controlPoints,
    captureTime:    battle.captureTime,
    contestDrain:   battle.contestDrain,
    zonePeriod:     battle.zonePeriod,
    flagReturnTime: battle.flagReturnTime,
  }
}

export type Issue = { level: 'error' | 'warn'; message: string }

/**
 * What is wrong with this map, in the runtime's terms.
 *
 * Every check here is a failure mode the shipped levels document having hit:
 * a spline that starts already curving banks the deck out from under the grid;
 * a spawn inside a mesa buries the ship; a fog far plane short of the deck
 * diagonal hides the thing you are meant to steer at. Warnings do not block
 * export — a sprint with two gates is legal, just unusual.
 */
export function validate (doc: EditorDocument): Issue[] {
  const issues: Issue[] = []

  if (doc.environment.fogNear >= doc.environment.fogFar)
    issues.push({ level: 'error', message: 'Fog near plane is not in front of the far plane.' })

  return issues.concat(doc.kind === 'race' ? validateRace(doc) : validateBattle(doc))
}

function validateRace (doc: EditorDocument): Issue[] {
  const issues: Issue[]       = []
  const { nodes, loop, laps } = doc.race
  const env                   = doc.environment

  if (nodes.length < 4)
    issues.push({ level: 'error', message: `A Catmull-Rom needs four control points to curve; this route has ${nodes.length}.` })
  if (loop && laps < 1)
    issues.push({ level: 'error', message: 'A circuit needs at least one lap.' })
  if (nodes.some(n => n.width < 8))
    issues.push({ level: 'warn', message: 'A node narrower than 8 m is tighter than the gate half-width; ships will clip the edge.' })

  // Gate 0 IS the start line, and the grid sits on it facing the next node.
  const [ a, b, c ] = nodes
  if (a && b && c && !colinear(a, b, c))
    issues.push({ level: 'warn', message: 'The first three nodes are not colinear — the deck will already be banking under the starting grid.' })

  const diagonal = spanOf(nodes)
  if (env.fogFar < diagonal)
    issues.push({ level: 'warn', message: `Fog far plane (${Math.round(env.fogFar)} m) is shorter than the circuit's ${Math.round(diagonal)} m span.` })

  return issues
}

function validateBattle (doc: EditorDocument): Issue[] {
  const issues: Issue[]                   = []
  const { spawns, zones, half, plateaus } = doc.battle

  for (const team of BATTLE_TEAMS)
    if (!spawns.some(s => s.team === team))
      issues.push({ level: 'error', message: `Team ${team} has no spawn point and cannot enter the match.` })

  if (!zones.length)
    issues.push({ level: 'warn', message: 'No capture zones — nothing to score.' })

  for (const s of spawns)
    if (plateaus.some(p => Math.abs(s.x - p.centreX) <= p.halfX && Math.abs(s.z - p.centreZ) <= p.halfZ))
      issues.push({ level: 'error', message: `Spawn at ${Math.round(s.x)}, ${Math.round(s.z)} is inside a mesa.` })

  for (const item of [ ...spawns, ...zones ])
    if (Math.abs(item.x) > half - 12 || Math.abs(item.z) > half - 12)
      issues.push({ level: 'error', message: `${'name' in item ? item.name : 'A spawn'} sits in or beyond the perimeter wall.` })

  if (doc.environment.fogFar < half * 2.9)
    issues.push({ level: 'warn', message: `Fog far plane (${Math.round(doc.environment.fogFar)} m) is shorter than the deck diagonal (${Math.round(half * 2.83)} m).` })

  return issues
}

/** A point on the deck plan — the only two coordinates these two checks read. */
type PlanPoint = { x: number; z: number }

function colinear (a: PlanPoint, b: PlanPoint, c: PlanPoint): boolean {
  const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)
  return Math.abs(cross) < 1
}

function spanOf (nodes: PlanPoint[]): number {
  const xs = nodes.map(n => n.x)
  const zs = nodes.map(n => n.z)
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs))
}
