import type { BoxCollider } from 'Φcolliders'


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
 * A battle arena, as data — and now ONLY as data.
 *
 * Deliberately NOT the race `TrackSpec` (which carries waypoints and laps):
 * battle is objective-based, so the arena describes bases, control zones and
 * spawn points instead. Colliders stay box strips, for the hover rays.
 *
 * The `buildVisual` member this type used to carry is gone. It was the last
 * thing tying the arena to a renderer, and an arena the server instantiates
 * sixty times a second has no business holding a closure over a THREE.Scene.
 * The meshes now live in `src/engine/battle/arena-visuals.ts`, keyed by
 * `arena.id`.
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

/**
 * Where the key light reads as coming FROM, in world space.
 *
 * Distinct from `sunModule`'s DirectionalLight, which chases the ship to keep
 * the shadow frustum useful and so has no stable sky position. The god-ray pass
 * and the visible sun disc both anchor here instead, low on the horizon behind
 * the blue end of the deck so the shafts rake across the mesas rather than
 * pouring straight down.
 */
export const SUN_ANCHOR: [number, number, number] = [ -430, 300, 1150 ]

const spawn = (x: number, z: number, yawPi: boolean): ArenaTransform => ({ position: [ x, 0, z ], quaternion: yawPi ? [ 0, 1, 0, 0 ] : [ 0, 0, 0, 1 ]})

const box = (
  position: [number, number, number],
  args: [number, number, number],
  rotation: [number, number, number] = [ 0, 0, 0 ]
): BoxCollider => ({ position, rotation, args })

/**
 * Turn a plateau into its collider set: one solid mesa plus one wedge per ramp.
 *
 * The wedge is a rotated cuboid, not a trimesh, because the hover rays only
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
  }
}
