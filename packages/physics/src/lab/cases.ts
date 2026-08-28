import type { ForceSample } from '../thrusters'
import type { HovercraftInput } from '../vehicle-step'
import type { Transform } from '../types'

/**
 * The crash dummies.
 *
 * Each case is one atomic physical behaviour, in its own lane, expressed as
 * pure data: geometry, a spawn, an input timeline, and the checks that say
 * whether it did the thing. No rendering, no test framework, no rapier — so the
 * headless runner and the visual scene consume the SAME definition. If those two
 * could disagree about what a case is, a green test would stop describing the
 * thing you can watch, which is the entire point of building both.
 *
 * Lane-local coordinates throughout. Whoever builds the world adds the lane
 * offset; nothing in here knows where its lane sits.
 */

/** Metres between lane centres. Wide enough that no case can reach its neighbour. */
export const LANE_PITCH = 240

/** One static box. Half-extents, matching rapier's cuboid convention. */
export type LabSolid = {
  id?:      string;
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  half:     readonly [number, number, number];

  /** Visual hint for the scene. Physics ignores it. */
  colour?: string;
}

/** A loose box the ship can shove around. */
export type LabProp = LabSolid & { mass: number }

/**
 * External force in newtons, world axes, from a lane-local position.
 *
 * A pure function of tick and position — no rng, no wall clock — because these
 * runs have to be byte-identical between invocations.
 */
export type WindField = (
  tick: number,
  pos: readonly [number, number, number]
) => readonly [number, number, number]

export type LabKeyframe = {

  /** Seconds from the start of the timeline. */
  at:    number;
  input: Partial<HovercraftInput>;
}

/**
 * A check, as a predicate rather than an assertion.
 *
 * Deliberately not `expect()`: the visual scene wants to show pass/fail per lane
 * too, and it cannot import vitest. The test file turns these into assertions.
 */
export type LabCheck = {
  label: string;
  run (trace: LabTrace): boolean;
}

/** What a check gets to look at. Defined here to keep the case file self-contained. */
export type LabTrace = {
  id:     string;
  frames: readonly LabFrame[];
  props:  readonly (readonly [number, number, number])[][];
  hash:   string;
}

export type LabFrame = {
  tick:      number;
  pos:       readonly [number, number, number];
  linvel:    readonly [number, number, number];
  angvel:    readonly [number, number, number];
  fwdSpeed:  number;
  latSpeed:  number;
  speed:     number;
  yawRate:   number;
  up:        number;
  pitch:     number;
  roll:      number;
  grounded:  boolean;
  contacts:  number;
  airbrake:  number;
  engine:    number;
  netForce:  readonly [number, number, number];
  netTorque: readonly [number, number, number];
  throttles: readonly number[];

  /**
   * Every force applied on this tick, lane-local.
   *
   * Recorded rather than recomputed because the visual lab plays the trace back
   * instead of re-simulating: that is what makes scrubbing exact and stepping
   * BACKWARDS possible at all, and it means the arrows you scrub to are the
   * arrows the assertions ran against.
   */
  forces: readonly ForceSample[];
}

export type CrashCase = {
  id:       string;
  title:    string;
  lane:     number;
  duration: number;

  /**
   * Speed the engines govern toward, m/s. Defaults to the hull maximum.
   *
   * Turn radius is `v / yawRate`, so a lane that wants a TIGHT turn has to want
   * a slow one — at full throttle the ship's yaw authority also halves, and the
   * "tightest possible U-turn" comes out a 138 m loop.
   */
  targetSpeed?: number;
  spawn:        Transform;
  solids:       readonly LabSolid[];
  props?:       readonly LabProp[];
  wind?:        WindField;
  timeline:     readonly LabKeyframe[];
  checks:       readonly LabCheck[];
}

// --- helpers ---------------------------------------------------------------

const FACING_Z: Transform['quaternion'] = [ 0, 0, 0, 1 ]

/** A lane floor. Sunk so its top face is flush at y = 0. */
const floor = (halfX = 90, halfZ = 320, colour = '#171a26'): LabSolid => ({
  id:       'floor',
  position: [ 0, -1, 0 ],
  rotation: [ 0, 0, 0 ],
  half:     [ halfX, 1, halfZ ],
  colour,
})

const at = (t: number, input: Partial<HovercraftInput>): LabKeyframe => ({ at: t, input })

const last  = (trace: LabTrace) => trace.frames[trace.frames.length - 1]
const maxOf = (trace: LabTrace, pick: (f: LabFrame) => number) => Math.max(...trace.frames.map(pick))
const minOf = (trace: LabTrace, pick: (f: LabFrame) => number) => Math.min(...trace.frames.map(pick))

/** Never on its back, never through the floor — every lane owes these. */
const survives = (floorY = -8, minUp: number | null = 0.5): LabCheck[] => [
  ...minUp === null
    ? []
    : [{ label: 'stays upright', run: (t: LabTrace) => minOf(t, f => f.up) > minUp }],
  { label: 'does not fall out of the world', run: t => minOf(t, f => f.pos[1]) > floorY },
]

/**
 * Does the ground path cross itself?
 *
 * The honest test for a figure eight. Counting turns in both directions is not
 * enough — an S-bend does that too, and only a crossing makes it an eight.
 */
function selfIntersects (trace: LabTrace): boolean {
  const pts   = trace.frames.filter((_, i) => i % 6 === 0).map(f => [ f.pos[0], f.pos[2] ] as const)
  const cross = (o: readonly number[], a: readonly number[], b: readonly number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

  for (let i = 0; i + 1 < pts.length; i++)
    // Skip neighbours: consecutive segments share an endpoint by construction.
    for (let j = i + 3; j + 1 < pts.length; j++) {
      const [ p, p2, q, q2 ] = [ pts[i], pts[i + 1], pts[j], pts[j + 1] ]
      const d1               = cross(p, p2, q)
      const d2               = cross(p, p2, q2)
      const d3               = cross(q, q2, p)
      const d4               = cross(q, q2, p2)
      if (d1 * d2 < 0 && d3 * d4 < 0)
        return true
    }
  return false
}

// --- the lanes -------------------------------------------------------------

export const CRASH_CASES: readonly CrashCase[] = [
  {
    id:       'wall-slam',
    title:    'full thrust + boost into a wall',
    lane:     0,
    duration: 9,
    spawn:    { position: [ 0, 1, -120 ], quaternion: FACING_Z },
    solids:   [
      floor(),
      // Buried two metres, because a barrier whose bottom face is coplanar with
      // the deck is a seam a fast hull squeezes through rather than a wall.
      { id: 'wall', position: [ 0, 4, 110 ], rotation: [ 0, 0, 0 ], half: [ 40, 6, 3 ], colour: '#ff2d6f' },
    ],
    timeline: [ at(0, { throttle: true, boost: true }) ],
    checks:   [
      ...survives(),
      { label: 'gets properly quick first', run: t => maxOf(t, f => f.fwdSpeed) > 45 },
      { label: 'is stopped by the wall', run: t => Math.abs(last(t).fwdSpeed) < 6 },
      { label: 'does not tunnel through it', run: t => maxOf(t, f => f.pos[2]) < 108 },
    ],
  },

  {
    id:          'figure-eight',
    title:       'thrust, tightest U-turn, mirror it — an eight',
    lane:        1,
    duration:    23,
    targetSpeed: 12,
    spawn:       { position: [ 0, 1, -40 ], quaternion: FACING_Z },
    solids:      [ floor(70, 90) ],
    timeline:    [
      // One loop is 2*pi / yawRate, about ten seconds at this speed, and each
      // window overshoots that slightly on purpose: two circles that merely meet
      // give a tangent point, and a tangent point is not a crossing. Overlapping
      // them is what makes the path an eight instead of an S.
      at(0, { throttle: true }),
      at(2.0, { throttle: true, steer: 1 }),
      at(12.4, { throttle: true, steer: -1 }),
      at(22.8, { throttle: true, steer: 0 }),
    ],
    checks: [
      ...survives(),
      { label: 'turns hard right at some point', run: t => minOf(t, f => f.yawRate) < -0.6 },
      { label: 'turns hard left at some point', run: t => maxOf(t, f => f.yawRate) > 0.6 },
      { label: 'the path crosses itself', run: selfIntersects },
      {
        label: 'comes back near where it started',
        run:   t => Math.hypot(last(t).pos[0], last(t).pos[2] + 40) < 80,
      },
    ],
  },

  {
    id:       'ramp-jump',
    title:    'off a ramp and back down',
    lane:     2,
    duration: 9,
    spawn:    { position: [ 0, 1, -70 ], quaternion: FACING_Z },
    solids:   [
      floor(),
      // Low end buried in the deck so there is no lip to trip over — the launch
      // should come from the slope, not from clipping a corner.
      { id: 'ramp', position: [ 0, 2.4, 5 ], rotation: [ -0.25, 0, 0 ], half: [ 9, 0.6, 12 ], colour: '#22d3ee' },
    ],
    timeline: [ at(0, { throttle: true }) ],
    checks:   [
      ...survives(),
      { label: 'actually leaves the ground', run: t => t.frames.filter(f => !f.grounded).length > 30 },
      { label: 'gets real air', run: t => maxOf(t, f => f.pos[1]) > 4 },
      { label: 'lands again', run: t => t.frames.slice(-40).some(f => f.grounded) },
      { label: 'lands the right way up', run: t => last(t).up > 0.9 },
      { label: 'clears the ramp', run: t => last(t).pos[2] > 25 },
    ],
  },

  {
    id:       'station-keeping',
    title:    'parked on a slope, engines lit, air brakes out',
    lane:     3,
    duration: 12,
    spawn:    { position: [ 0, 1.2, -60 ], quaternion: FACING_Z },
    // A SLOPE, so holding station costs continuous main thrust. On the flat the
    // trim loop settles at zero throttle and the case proves nothing.
    solids:   [
      // Rotated so +Z is UPHILL. The ship faces +Z, so gravity pulls it
      // backwards and holding station costs continuous MAIN thrust. Tilt it the
      // other way and the retros do all the work, which proves the opposite of
      // what this lane is named for.
      { id: 'slope', position: [ 0, -1, 0 ], rotation: [ -0.07, 0, 0 ], half: [ 60, 1, 200 ], colour: '#1d2233' },
    ],
    timeline: [
      at(0, { throttle: true }),
      at(2, { throttle: true, brake: true }),
    ],
    checks: [
      ...survives(),
      {
        label: 'holds position once trimmed',
        run:   t => {
          const held = t.frames.filter(f => f.tick > 4 * 60)
          return Math.max(...held.map(f => Math.abs(f.fwdSpeed))) < 2
        },
      },
      { label: 'air brakes are deployed while holding', run: t => last(t).airbrake > 0.8 },
      {
        label: 'main engines stay lit against the slope',
        run:   t => t.frames.filter(f => f.tick > 4 * 60 && f.engine > 1).length > 60,
      },
    ],
  },

  {
    id:       'brake-reverse',
    title:    'accelerate, full brake, then back it up',
    lane:     4,
    duration: 14,
    spawn:    { position: [ 0, 1, -150 ], quaternion: FACING_Z },
    solids:   [ floor() ],
    timeline: [
      at(0, { throttle: true }),
      at(5, { throttle: false, brake: true }),
    ],
    checks: [
      ...survives(),
      { label: 'gets up to speed', run: t => maxOf(t, f => f.fwdSpeed) > 35 },
      {
        label: 'brakes to a near stop',
        run:   t => t.frames.some(f => f.tick > 5 * 60 && f.tick < 8 * 60 && Math.abs(f.fwdSpeed) < 2),
      },
      { label: 'then reverses', run: t => minOf(t, f => f.fwdSpeed) < -2 },
      { label: 'reverse stays a parking speed', run: t => minOf(t, f => f.fwdSpeed) > -15 },
    ],
  },

  {
    id:       'strafe-ledge',
    title:    'strafe off a ledge onto a lower deck',
    lane:     5,
    duration: 9,
    spawn:    { position: [ -6, 1, 0 ], quaternion: FACING_Z },
    solids:   [
      { id: 'upper', position: [ -20, -1, 0 ], rotation: [ 0, 0, 0 ], half: [ 20, 1, 60 ], colour: '#1d2233' },
      { id: 'lower', position: [ 26, -7, 0 ], rotation: [ 0, 0, 0 ], half: [ 26, 1, 60 ], colour: '#151827' },
    ],
    timeline: [
      at(0, { strafe: 1 }),
      at(3, { strafe: 0 }),
    ],
    checks: [
      // No upright check while it is in the air: the pads on the outboard side
      // lose the deck first, so it leaves the ledge with a real roll on. What
      // matters is that it comes down the right way up, which is checked below.
      ...survives(-20, null),
      { label: 'goes over the edge', run: t => maxOf(t, f => f.pos[0]) > 2 },
      { label: 'drops to the lower deck', run: t => minOf(t, f => f.pos[1]) < -3 },
      { label: 'ends up resting on it', run: t => last(t).grounded && last(t).pos[1] > -7 },
      { label: 'lands the right way up', run: t => last(t).up > 0.85 },
    ],
  },

  {
    id:       'turbulence-tube',
    title:    'through a tube against a turbine wash',
    lane:     6,
    duration: 13,
    spawn:    { position: [ 0, 1, -80 ], quaternion: FACING_Z },
    solids:   [
      floor(),
      { id: 'tube.left', position: [ -7, 4, 10 ], rotation: [ 0, 0, 0 ], half: [ 1, 5, 45 ], colour: '#2b3348' },
      { id: 'tube.right', position: [ 7, 4, 10 ], rotation: [ 0, 0, 0 ], half: [ 1, 5, 45 ], colour: '#2b3348' },
      { id: 'tube.roof', position: [ 0, 9.5, 10 ], rotation: [ 0, 0, 0 ], half: [ 8, 0.5, 45 ], colour: '#2b3348' },
      { id: 'turbine', position: [ 0, 4.5, 58 ], rotation: [ 0, 0, 0 ], half: [ 7, 4.5, 1 ], colour: '#ffd166' },
    ],
    // A headwind with a swirl, only inside the tube. Pure function of tick and
    // position: no rng, no clock, so two runs are byte-identical.
    wind: (tick, pos) => {
      const inside = Math.abs(pos[0]) < 7 && pos[2] > -35 && pos[2] < 55 && pos[1] < 10
      if (!inside)
        return [ 0, 0, 0 ]

      const t = tick / 60
      return [
        Math.sin(t * 3.1) * 1100,
        Math.sin(t * 2.3 + 1) * 320,
        -700,
      ]
    },
    timeline: [ at(0, { throttle: true }) ],
    checks:   [
      ...survives(),
      { label: 'makes it into the tube', run: t => maxOf(t, f => f.pos[2]) > -20 },
      { label: 'gets shoved around by the wash', run: t => maxOf(t, f => Math.abs(f.pos[0])) > 1 },
      { label: 'never gets flipped by it', run: t => minOf(t, f => f.up) > 0.7 },
      { label: 'is still flying at the end', run: t => last(t).pos[1] > -2 },
    ],
  },

  {
    id:       'nudge-props',
    title:    'shoulder through a stack of loose crates',
    lane:     7,
    duration: 9,
    spawn:    { position: [ 0, 1, -60 ], quaternion: FACING_Z },
    solids:   [ floor() ],
    // Three rows of three, spaced so the one-metre-wide hull actually overlaps
    // every column. Stacked as a wall, or spread 1.05 m apart, only the centre
    // column was ever touched — and those three rode the nose for 180 m rather
    // than scattering, which is a plough, not a nudge. Light, so they fly.
    props:    Array.from({ length: 9 }, (_, i) => ({
      id:       `crate.${i}`,
      position: [ (i % 3 - 1) * 0.8, 0.48, 8 + Math.floor(i / 3) * 4 ] as const,
      rotation: [ 0, 0, 0 ] as const,
      half:     [ 0.45, 0.45, 0.45 ] as const,
      mass:     8,
      colour:   '#f7b267',
    })),
    timeline: [ at(0, { throttle: true }) ],
    checks:   [
      ...survives(),
      {
        label: 'scatters most of the stack',
        run:   t => {
          const start = t.props[0]
          const end   = t.props[t.props.length - 1]
          const moved = start.filter((p, i) => Math.hypot(
            end[i][0] - p[0], end[i][1] - p[1], end[i][2] - p[2]
          ) > 1)
          return moved.length >= 6
        },
      },
      { label: 'keeps going through them', run: t => last(t).pos[2] > 20 },
      { label: 'is not stopped dead by a crate', run: t => maxOf(t, f => f.fwdSpeed) > 30 },
    ],
  },
]

export const caseById = (id: string): CrashCase => {
  const found = CRASH_CASES.find(c => c.id === id)
  if (!found)
    throw new Error(`no crash case "${id}"`)
  return found
}
