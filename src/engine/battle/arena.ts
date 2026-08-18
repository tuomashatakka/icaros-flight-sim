import * as THREE from 'three'
import type { SceneContext } from 'threejs-scene'
import type { BoxCollider } from '@/lib/track/build-track'


export type BattleTeam = 'red' | 'blue'

export const BATTLE_TEAMS: BattleTeam[] = [ 'red', 'blue' ]

export function otherTeam (team: BattleTeam): BattleTeam {
  return team === 'red' ? 'blue' : 'red'
}

/** The teams' accent colours, shared by the arena visuals and the HUD. */
export const TEAM_COLORS: Record<BattleTeam, string> = {
  red:  '#ff2d6f',
  blue: '#22d3ee',
}

/** Neutral sign displayed while a control point is unowned. */
export const NEUTRAL_COLOR = '#b7f34a'

export type ArenaTransform = {
  position:   [number, number, number];
  quaternion: [number, number, number, number];
}

export type ControlPointDef = {
  id:   string;
  name: string;

  /** 1–2 character code for the HUD pips, where the full name will not fit. */
  short:    string;
  position: [number, number, number];
  radius:   number;
}

/** Which face of a plateau a ramp climbs. */
export type RampSide = '+x' | '-x' | '+z' | '-z'

export type PlateauDef = {
  id:    string;
  name:  string;
  short: string;

  /** Footprint centre, XZ. */
  centre: [number, number];

  /** Footprint half-extents, XZ. */
  half: [number, number];

  /** Deck height of the top surface. */
  height: number;
  ramps:  RampSide[];
}

/**
 * A battle arena, as data.
 *
 * Deliberately NOT the race `LevelSpec` (which carries waypoints/laps): battle
 * is objective-based, so the arena describes bases, control zones and spawn
 * points instead. Colliders stay box strips for the raycast wheels. The module
 * is Node-safe — `SceneContext` is type-only, so the headless server can import
 * the collider/shape data without dragging in the renderer.
 */
export type BattleArena = {
  id:         string;
  name:       string;
  tagline:    string;
  background: string;
  fog:        [string, number, number];
  bloom:      { strength: number; threshold: number; radius: number };

  /** Deck height. Vehicles hover above this. */
  floorY: number;

  /** Deck half-extent. The perimeter wall stands just inside it. */
  half: number;

  colliders:      BoxCollider[];
  colliderOffset: [number, number, number];

  /** Raised mesas, for the visual layer and the bots' line-of-sight guesses. */
  plateaus: PlateauDef[];

  /** Base positions + where each team's objective rests when home. */
  bases: Record<BattleTeam, {
    position: [number, number, number];
    flagRest: [number, number, number];
  }>;

  /** Vehicle entry points — explore these out, not into the enemy side. */
  spawns: Record<BattleTeam, ArenaTransform[]>;

  controlPoints: ControlPointDef[];

  // --- rule timings, in SIM seconds ---
  captureTime:    number; // seconds of uncontested presence to flip a zone
  contestDrain:   number; // seconds an intruder needs to strip a held zone
  zonePeriod:     number; // seconds of ownership per +1 score tick
  flagReturnTime: number; // seconds a dropped objective waits before returning home

  buildVisual(ctx: SceneContext): void;
}

// --- Apex Basin dimensions --------------------------------------------------
// The deck went from 200×200 to 600×600 — 9× the floor area — so the plateaus
// have somewhere to sit without turning every lane into a corridor. Everything
// downstream (spawns, bases, zones, fog, camera far plane) is sized off HALF.
const HALF        = 300
const WALL_IN     = 6 // wall half-thickness; its inner face sits at HALF - 2*WALL_IN
const WALL_H      = 26 // wall half-height: a 52-unit cliff no ramp launch clears
const RAMP_HALF_W = 13 // half-width of a ramp deck
const RAMP_SLOPE  = 4.2 // horizontal run per unit of climb (~13.4°)

// Fog has to clear the whole deck diagonal (~850) or the mesas you are meant to
// be navigating toward simply are not there when you look up from your spawn.
const FOG: [string, number, number] = [ '#0d1120', 340, 1500 ]

/** Deck half-extent, exported so the client scene can size its own floor to match. */
export const ARENA_HALF = HALF

const spawn = (x: number, z: number, yawPi: boolean): ArenaTransform => ({ position: [ x, 0, z ], quaternion: yawPi ? [ 0, 1, 0, 0 ] : [ 0, 0, 0, 1 ]})

const box = (
  position: [number, number, number],
  args: [number, number, number],
  rotation: [number, number, number] = [ 0, 0, 0 ]
): BoxCollider => ({ position, rotation, args })

/**
 * Turn a plateau into its collider set: one solid mesa plus one wedge per ramp.
 *
 * The wedge is a rotated cuboid, not a trimesh, because the raycast wheels only
 * collide with cuboids. Its top face is the drivable surface, so the box is
 * placed by taking the surface centreline and pushing it DOWN along the surface
 * normal by the slab thickness — offsetting the box centre directly would sink
 * the ramp by `t / cos θ` and leave a lip at the mesa edge.
 */
export function plateauColliders (p: PlateauDef): BoxCollider[] {
  const [ cx, cz ] = p.centre
  const [ hx, hz ] = p.half
  const h          = p.height
  const out        = [ box([ cx, h / 2, cz ], [ hx, h / 2, hz ]) ]

  const run   = h * RAMP_SLOPE
  const slope = Math.hypot(h, run)
  const theta = Math.atan2(h, run)
  const sin   = Math.sin(theta)
  const cos   = Math.cos(theta)

  // Half-thickness chosen so the wedge's UNDERSIDE meets the deck exactly where
  // its top meets the mesa: bottom = h - 2·t·cos θ = 0. A thin plank instead
  // leaves a wedge-shaped cave under the ramp, and a ship that wanders into it
  // ends up pinned against the mesa's vertical face with no way out — which is
  // precisely where the bots parked before this.
  const thick = h / (2 * cos)

  // Sink the low end below the deck so a wheel ray at the seam always finds
  // slab rather than falling into the join.
  const overhang = 3
  const halfLen  = (slope + overhang) / 2
  const shift    = overhang / 2 // down-slope nudge of the box centre

  for (const side of p.ramps) {
    const alongZ = side === '+z' || side === '-z'
    const sign   = side === '+x' || side === '+z' ? 1 : -1

    // Centre of the ramp's TOP surface, then step to the BOX centre by moving
    // one slab thickness along -normal. The surface tips away from the mesa, so
    // its normal leans outward by `sin θ` — dropping that term (or flipping it)
    // slides the high end off the mesa edge and opens a slot at the join.
    const midY = h / 2 - shift * sin

    if (alongZ) {
      const midZ = cz + sign * (hz + run / 2 + shift * cos)
      out.push(box(
        [ cx, midY - thick * cos, midZ - sign * thick * sin ],
        [ RAMP_HALF_W, thick, halfLen ],
        [ sign > 0 ? theta : -theta, 0, 0 ]
      ))
    }
    else {
      const midX = cx + sign * (hx + run / 2 + shift * cos)
      out.push(box(
        [ midX - sign * thick * sin, midY - thick * cos, cz ],
        [ halfLen, thick, RAMP_HALF_W ],
        [ 0, 0, sign > 0 ? -theta : theta ]
      ))
    }
  }

  return out
}

/**
 * Ground-level entry point of each of a plateau's ramps.
 *
 * Bots steer to one of these before they steer at anything standing on top —
 * a naive seek drives straight into the mesa wall and parks there.
 */
export function rampFeet (p: PlateauDef): Array<[number, number]> {
  const [ cx, cz ] = p.centre
  const [ hx, hz ] = p.half
  const run        = p.height * RAMP_SLOPE

  return p.ramps.map((side): [number, number] => {
    switch (side) {
      case '+z': return [ cx, cz + hz + run ]
      case '-z': return [ cx, cz - hz - run ]
      case '+x': return [ cx + hx + run, cz ]
      default: return [ cx - hx - run, cz ]
    }
  })
}

/**
 * Where a ship at (x, z) should aim to get up onto `p`.
 *
 * Two answers only. Lined up on a ramp's centreline between its foot and the
 * mesa edge, the answer is the mesa centre — that line IS the ramp. Anywhere
 * else it is the gate of the ramp facing the ship: a staging point out on the
 * deck beyond the foot, so the approach straightens out before the climb.
 *
 * Which ramp is chosen by ANGULAR SECTOR — the ramp whose outward direction
 * best matches the ship's bearing from the mesa centre. Two more obvious rules
 * both fail:
 *
 * - Nearest gate flips as you travel between two gates, so the goal swaps, the
 *   ship turns around, and it paces the gap between them forever.
 * - A fixed ramp per ship never flips, but half the time it is the one on the
 *   far side of the mesa, and a ship with no path planning drives straight into
 *   the cliff and grinds along it.
 *
 * Sector selection is self-reinforcing instead: heading for a gate moves your
 * bearing further into that ramp's sector, and the boundary between sectors
 * sits out on a diagonal where both gates are equally reachable.
 *
 * The lateral tolerance is deliberately TIGHTER than the ramp, not wider. A
 * generous one lets a ship beside the ramp think it is on it, drive at the
 * mesa's vertical face, and pin itself there.
 */
export function rampApproach (p: PlateauDef, x: number, z: number): [number, number] {
  const [ cx, cz ] = p.centre
  const [ hx, hz ] = p.half
  const run        = p.height * RAMP_SLOPE
  const lateral    = RAMP_HALF_W - 2

  const dx      = x - cx
  const dz      = z - cz
  const bearing = Math.hypot(dx, dz)

  let gate: [number, number] = [ cx, cz ]
  let bestFacing             = -Infinity

  for (const side of p.ramps) {
    const alongZ = side === '+z' || side === '-z'
    const sign   = side === '+x' || side === '+z' ? 1 : -1
    const edge   = alongZ ? cz + sign * hz : cx + sign * hx
    const foot   = edge + sign * run

    // The committed strip runs PAST the foot far enough to swallow the gate: if
    // the gate sat outside it, a ship that reached the gate would find it zero
    // distance away, have no heading to hold, and circle it forever.
    const stage = foot + sign * run * 0.45
    const outer = foot + sign * run * 0.55

    const axial   = alongZ ? z : x
    const cross   = alongZ ? dx : dz
    const between = sign > 0 ? axial >= edge && axial <= outer : axial <= edge && axial >= outer
    if (between && Math.abs(cross) <= lateral)
      return [ cx, cz ]

    // Dot of the ship's bearing with this ramp's outward direction.
    const facing = bearing < 1e-3 ? 0 : (alongZ ? dz : dx) * sign / bearing
    if (facing > bestFacing) {
      bestFacing = facing
      gate       = alongZ ? [ cx, stage ] : [ stage, cz ]
    }
  }

  return gate
}

/** True when an XZ point stands on the plateau's top surface footprint. */
export function onPlateau (p: PlateauDef, x: number, z: number): boolean {
  return Math.abs(x - p.centre[0]) <= p.half[0] && Math.abs(z - p.centre[1]) <= p.half[1]
}

/** Mirror a plateau across either axis, keeping its ramps pointing the same way relative to it. */
function mirrorPlateau (p: PlateauDef, id: string, name: string, short: string, sx: 1 | -1, sz: 1 | -1): PlateauDef {
  const flip = (side: RampSide): RampSide => {
    if (side === '+x')
      return sx > 0 ? '+x' : '-x'
    if (side === '-x')
      return sx > 0 ? '-x' : '+x'
    if (side === '+z')
      return sz > 0 ? '+z' : '-z'
    return sz > 0 ? '-z' : '+z'
  }

  return {
    id,
    name,
    short,
    centre: [ p.centre[0] * sx, p.centre[1] * sz ],
    half:   [ ...p.half ] as [number, number],
    height: p.height,
    ramps:  p.ramps.map(flip),
  }
}

const RED_SPAWN    = spawn(0, -250, false)
const BLUE_SPAWN   = spawn(0, 250, true)
const RED_SPAWN_L  = spawn(-46, -258, false)
const BLUE_SPAWN_L = spawn(-46, 258, true)
const RED_SPAWN_R  = spawn(46, -258, false)
const BLUE_SPAWN_R = spawn(46, 258, true)

/**
 * Apex Basin — a symmetric CTF/domination arena on a walled 600×600 deck.
 *
 * Teams line up along Z: red defends z < 0, blue z > 0. Five mesas carry the
 * five control zones — one pair per side plus the central spire — and every one
 * of them is reachable by two ramps, so no plateau can be held by parking on
 * its only entrance. The perimeter is a continuous 52-unit cliff wall backed by
 * a skyline of towers: there is no lip to fall off.
 */
export function apexArena (): BattleArena {
  const redInner: PlateauDef = {
    id:     'ridge-sw',
    name:   'Southwest Ridge',
    short:  'SW',
    centre: [ -156, -150 ],
    half:   [ 60, 46 ],
    height: 11,
    ramps:  [ '+x', '-z' ],
  }

  const plateaus: PlateauDef[] = [
    {
      id:     'spire',
      name:   'Apex Spire',
      short:  'C',
      centre: [ 0, 0 ],
      half:   [ 82, 74 ],
      height: 16,
      ramps:  [ '-z', '+z' ],
    },
    redInner,
    mirrorPlateau(redInner, 'ridge-se', 'Southeast Ridge', 'SE', -1, 1),
    mirrorPlateau(redInner, 'ridge-nw', 'Northwest Bluff', 'NW', 1, -1),
    mirrorPlateau(redInner, 'ridge-ne', 'Northeast Bluff', 'NE', -1, -1),
  ]

  const ground: BoxCollider[] = [
    box([ 0, -0.5, 0 ], [ HALF, 0.5, HALF ]),

    // Perimeter cliff. The four slabs overlap at the corners on purpose — a
    // gap there is exactly where a boosting ship squeezes out of the map.
    box([ 0, WALL_H, HALF - WALL_IN ], [ HALF, WALL_H, WALL_IN ]),
    box([ 0, WALL_H, -(HALF - WALL_IN) ], [ HALF, WALL_H, WALL_IN ]),
    box([ HALF - WALL_IN, WALL_H, 0 ], [ WALL_IN, WALL_H, HALF ]),
    box([ -(HALF - WALL_IN), WALL_H, 0 ], [ WALL_IN, WALL_H, HALF ]),
  ]

  // Midfield cover — mirrored through the origin so neither team inherits a
  // home-side block dump.
  const cover: BoxCollider[] = ([
    [ 112, 62 ], [ 210, -18 ], [ 66, 214 ],
  ] as Array<[number, number]>).flatMap(([ x, z ]) => [
    box([ x, 4.5, z ], [ 12, 4.5, 7 ]),
    box([ -x, 4.5, -z ], [ 12, 4.5, 7 ]),
  ])

  const bases: BattleArena['bases'] = {
    red:  { position: [ 0, 0, -272 ], flagRest: [ 0, 2.2, -272 ]},
    blue: { position: [ 0, 0, 272 ], flagRest: [ 0, 2.2, 272 ]},
  }

  // One zone per mesa. The radius stays inside each footprint, so holding a
  // point means standing ON the plateau, not idling at its foot.
  const controlPoints: ControlPointDef[] = plateaus.map(p => ({
    id:       p.id,
    name:     p.name,
    short:    p.short,
    position: [ p.centre[0], p.height, p.centre[1] ] as [number, number, number],
    radius:   p.id === 'spire' ? 40 : 30,
  }))

  return {
    id:         'apex',
    name:       'Apex Basin',
    tagline:    'Five mesas, two ramps each, and nowhere to fall off.',
    background: '#0a0c14',
    fog:        FOG,
    bloom:      { strength: 0.34, threshold: 0.86, radius: 0.5 },
    floorY:     0,
    half:       HALF,

    colliders:      [ ...ground, ...cover, ...plateaus.flatMap(plateauColliders) ],
    colliderOffset: [ 0, 0, 0 ],

    plateaus,
    bases,
    spawns: {
      red:  [ RED_SPAWN, RED_SPAWN_L, RED_SPAWN_R ],
      blue: [ BLUE_SPAWN, BLUE_SPAWN_L, BLUE_SPAWN_R ],
    },

    controlPoints,
    captureTime:    9,
    contestDrain:   4.5,
    zonePeriod:     6,
    flagReturnTime: 8,

    buildVisual (ctx) {
      buildApexVisual(ctx, plateaus, bases)
    },
  }
}

// --- visuals ----------------------------------------------------------------

function mulberry32 (seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = a + 0x6d2b79f5 | 0

    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

/** Deck, mesas, cliff ring and the skyline behind it. */
function buildApexVisual (
  ctx: SceneContext,
  plateaus: PlateauDef[],
  bases: BattleArena['bases']
): void {
  const scene = ctx.scene
  const rng   = mulberry32(0xa9e5)

  const deckMat       = new THREE.MeshStandardMaterial({ color: '#14151f', metalness: 0.15, roughness: 0.92 })
  const floor         = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), deckMat)
  floor.rotation.x    = -Math.PI / 2
  floor.receiveShadow = true
  scene.add(floor)

  // Territory is marked with LINES, not a tinted area.
  //
  // The chase camera rides 3.5 units off the deck, so anything painted flat on
  // the floor near your own base fills most of the frame — a 90-unit tint band
  // turned the whole view into a maroon wash and made the arena unreadable.
  // Two thin markers per side say the same thing and cost no screen.
  for (const team of BATTLE_TEAMS) {
    const sign = team === 'red' ? -1 : 1
    for (const [ z, width, alpha ] of [
      [ sign * 205, 2.4, 0.45 ], [ sign * 268, 1.2, 0.28 ],
    ] as Array<[number, number, number]>) {
      const line = new THREE.Mesh(
        new THREE.PlaneGeometry(HALF * 2, width),
        new THREE.MeshBasicMaterial({
          color:       TEAM_COLORS[team],
          transparent: true,
          opacity:     alpha,
          depthWrite:  false,
          toneMapped:  false,
        })
      )
      line.rotation.x = -Math.PI / 2
      line.position.set(0, 0.03, z)
      scene.add(line)
    }
  }

  // 10-unit cells. At 120 divisions the lines aliased into moiré bands the
  // moment the camera got low, which is where the camera always is.
  const grid      = new THREE.GridHelper(HALF * 2, 60, '#2f3550', '#1c1f30')
  grid.position.y = 0.02
  scene.add(grid)

  buildPlateauMeshes(scene, plateaus)
  buildPerimeter(scene, rng)

  // Base pylons holding each team's objective.
  for (const team of BATTLE_TEAMS) {
    const { position } = bases[team]
    const color        = TEAM_COLORS[team]

    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(16, 18, 1.2, 32),
      new THREE.MeshStandardMaterial({ color: '#1a1c2a', metalness: 0.5, roughness: 0.5 })
    )
    pad.position.set(position[0], 0.6, position[2])
    pad.receiveShadow = true
    scene.add(pad)

    const ringMat   = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, side: THREE.DoubleSide })
    const ring      = new THREE.Mesh(new THREE.RingGeometry(15.2, 17.6, 48), ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.set(position[0], 1.25, position[2])
    scene.add(ring)

    for (const dx of [ -13, 13 ]) {
      const pylon = new THREE.Mesh(
        new THREE.CylinderGeometry(0.6, 0.9, 12, 12),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 })
      )
      pylon.position.set(position[0] + dx, 6, position[2])
      pylon.castShadow = true
      scene.add(pylon)
    }
  }

  // Control zones are painted by the battle visual layer (per-ring materials
  // for ownership colours) — not static geometry here.

  scene.add(new THREE.HemisphereLight('#93a6ff', '#141726', 0.95))
  for (const [ x, z ] of [[ 0, 0 ], [ 0, -200 ], [ 0, 200 ]] as Array<[number, number]>) {
    const light = new THREE.PointLight('#aab4ff', 260, 1400, 1.6)
    light.position.set(x, 120, z)
    scene.add(light)
  }

  scene.fog = new THREE.Fog(FOG[0], FOG[1], FOG[2])
}

function buildPlateauMeshes (scene: THREE.Object3D, plateaus: PlateauDef[]): void {
  const rockMat = new THREE.MeshStandardMaterial({ color: '#232636', metalness: 0.25, roughness: 0.85 })
  const deckMat = new THREE.MeshStandardMaterial({ color: '#2c3145', metalness: 0.3, roughness: 0.72 })
  const rampMat = new THREE.MeshStandardMaterial({ color: '#343a52', metalness: 0.35, roughness: 0.62 })
  const edgeMat = new THREE.MeshBasicMaterial({ color: NEUTRAL_COLOR, transparent: true, opacity: 0.42 })

  for (const p of plateaus) {
    const [ cx, cz ] = p.centre
    const [ hx, hz ] = p.half
    const h          = p.height

    const body = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, h, hz * 2), rockMat)
    body.position.set(cx, h / 2, cz)
    body.castShadow    = true
    body.receiveShadow = true
    scene.add(body)

    // A thin cap in a lighter tone so the drivable surface reads from a
    // distance; polygon offset keeps it off the mesa's own top face.
    const cap      = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2 - 0.4, hz * 2 - 0.4), deckMat)
    cap.rotation.x = -Math.PI / 2
    cap.position.set(cx, h + 0.02, cz)
    cap.receiveShadow = true
    scene.add(cap)

    // Rim light strip: four bars tracing the top edge.
    for (const [ ox, oz, sx, sz ] of [
      [ 0, hz, hx * 2, 0.6 ], [ 0, -hz, hx * 2, 0.6 ],
      [ hx, 0, 0.6, hz * 2 ], [ -hx, 0, 0.6, hz * 2 ],
    ] as Array<[number, number, number, number]>) {
      const bar      = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), edgeMat)
      bar.rotation.x = -Math.PI / 2
      bar.position.set(cx + ox, h + 0.06, cz + oz)
      scene.add(bar)
    }

    // The ramps reuse the collider maths, so the mesh cannot drift from the
    // surface the wheels actually ride on.
    for (const collider of plateauColliders(p).slice(1)) {
      const [ ax, ay, az ] = collider.args
      const ramp           = new THREE.Mesh(new THREE.BoxGeometry(ax * 2, ay * 2, az * 2), rampMat)
      ramp.position.set(collider.position[0], collider.position[1], collider.position[2])
      ramp.rotation.set(collider.rotation[0], collider.rotation[1], collider.rotation[2])
      ramp.castShadow    = true
      ramp.receiveShadow = true
      scene.add(ramp)

      // Lit rails down both edges of the running surface. A bare grey wedge is
      // invisible against a grey deck from more than a hundred units out, and
      // finding the way up is the whole point of a ramp.
      const alongZ = az > ax
      const length = (alongZ ? az : ax) * 2
      const across = alongZ ? ax : az
      for (const side of [ -1, 1 ]) {
        const rail = new THREE.Mesh(
          new THREE.PlaneGeometry(alongZ ? 0.9 : length, alongZ ? length : 0.9),
          new THREE.MeshBasicMaterial({ color: NEUTRAL_COLOR, transparent: true, opacity: 0.5, toneMapped: false })
        )
        rail.rotation.x = -Math.PI / 2
        rail.position.set(alongZ ? side * (across - 0.7) : 0, ay + 0.05, alongZ ? 0 : side * (across - 0.7))
        ramp.add(rail)
      }
    }
  }
}

/** Cliff face + a deterministic skyline of towers, so the boundary reads as a place. */
function buildPerimeter (scene: THREE.Object3D, rng: () => number): void {
  const cliffMat = new THREE.MeshStandardMaterial({ color: '#191c28', metalness: 0.2, roughness: 0.9 })
  const wallH    = WALL_H * 2
  const inner    = HALF - WALL_IN

  for (const [ x, z, w, d ] of [
    [ 0, inner, HALF, WALL_IN ], [ 0, -inner, HALF, WALL_IN ],
    [ inner, 0, WALL_IN, HALF ], [ -inner, 0, WALL_IN, HALF ],
  ] as Array<[number, number, number, number]>) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w * 2, wallH, d * 2), cliffMat)
    wall.position.set(x, WALL_H, z)
    wall.castShadow    = true
    wall.receiveShadow = true
    scene.add(wall)
  }

  // Warning stripe along the inner face, at windscreen height.
  const stripeMat = new THREE.MeshBasicMaterial({ color: '#f0b429', transparent: true, opacity: 0.3, side: THREE.DoubleSide })
  for (const [ x, z, rot, len ] of [
    [ 0, inner - WALL_IN - 0.1, 0, HALF ], [ 0, -(inner - WALL_IN - 0.1), 0, HALF ],
    [ inner - WALL_IN - 0.1, 0, Math.PI / 2, HALF ], [ -(inner - WALL_IN - 0.1), 0, Math.PI / 2, HALF ],
  ] as Array<[number, number, number, number]>) {
    const stripe = new THREE.Mesh(new THREE.PlaneGeometry(len * 2, 2.2), stripeMat)
    stripe.position.set(x, 5, z)
    stripe.rotation.y = rot
    scene.add(stripe)
  }

  // Skyline: towers sitting OUTSIDE the wall. They are decoration only — the
  // wall is what stops you — so they carry no collider.
  const towerMat = new THREE.MeshStandardMaterial({ color: '#10131d', metalness: 0.45, roughness: 0.55 })
  const litMat   = new THREE.MeshBasicMaterial({ color: '#5a6bff', transparent: true, opacity: 0.5 })
  const towers   = new THREE.Group()

  for (let ring = 0; ring < 3; ring++) {
    const dist  = HALF + 26 + ring * 46
    const count = 34 + ring * 8
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2 + rng() * 0.06
      // Project the circle onto a square so the towers hug the wall line.
      const cs    = Math.cos(angle)
      const sn    = Math.sin(angle)
      const scale = 1 / Math.max(Math.abs(cs), Math.abs(sn))
      const x     = cs * scale * dist + (rng() - 0.5) * 22
      const z     = sn * scale * dist + (rng() - 0.5) * 22
      const h     = 40 + rng() * (150 + ring * 70)
      const w     = 12 + rng() * 22

      const tower = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * (0.7 + rng() * 0.7)), towerMat)
      tower.position.set(x, h / 2, z)
      tower.rotation.y = rng() * Math.PI
      towers.add(tower)

      if (rng() > 0.45) {
        const cap = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, 1.6), litMat)
        cap.position.set(x, h - 6 - rng() * 20, z + w * 0.5 + 0.2)
        towers.add(cap)
      }
    }
  }

  scene.add(towers)
}
