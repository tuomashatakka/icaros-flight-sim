/**
 * The hit geometry, testable on its own for the first time.
 *
 * It used to live inside `BattleSim.fireBeam`, welded to live rapier bodies, so
 * the only way to exercise it was to run a match and see whether anything died.
 * A ray-vs-sphere test that is wrong by a sign is invisible that way and
 * obvious here.
 */
import { describe, expect, it } from 'vitest'
import { HULL_CENTRE_Y, resolveBeamHits, resolveBlastHits } from 'Δengine/battle/hitscan'
import type { HitCandidate } from 'Δengine/battle/hitscan'


const ORIGIN = { x: 0, y: 0, z: 0 }
const FORWARD = { x: 0, y: 0, z: 1 }

/** An enemy `z` ahead, offset `off` sideways. Y is set so the hull centre is level. */
const enemy = (id: string, z: number, off = 0): HitCandidate => ({
  id,
  team:     'blue',
  position: { x: off, y: -HULL_CENTRE_Y, z },
})

const beam = (over: Partial<Parameters<typeof resolveBeamHits>[0]> = {}) => ({
  origin:    ORIGIN,
  direction: FORWARD,
  reach:     100,
  radius:    3,
  team:      'red' as const,
  ...over,
})

describe('resolveBeamHits', () => {
  it('hits an enemy dead ahead', () => {
    const hits = resolveBeamHits(beam(), [ enemy('a', 40) ])
    expect(hits).toHaveLength(1)
    expect(hits[0].distance).toBeCloseTo(40)
  })

  it('never hits a friendly', () => {
    const friend: HitCandidate = { id: 'f', team: 'red', position: { x: 0, y: -HULL_CENTRE_Y, z: 20 }}
    expect(resolveBeamHits(beam(), [ friend ])).toHaveLength(0)
  })

  it('misses when the target is further off-axis than the beam is wide', () => {
    expect(resolveBeamHits(beam({ radius: 3 }), [ enemy('a', 40, 2.9) ])).toHaveLength(1)
    expect(resolveBeamHits(beam({ radius: 3 }), [ enemy('a', 40, 3.1) ])).toHaveLength(0)
  })

  it('ignores anything behind the muzzle', () => {
    // The projection has to be signed. Unsigned, a ship directly behind the
    // shooter reads as a hit at the same distance as one in front.
    expect(resolveBeamHits(beam(), [ enemy('a', -40) ])).toHaveLength(0)
  })

  it('ignores anything past the beam reach', () => {
    expect(resolveBeamHits(beam({ reach: 50 }), [ enemy('a', 49) ])).toHaveLength(1)
    expect(resolveBeamHits(beam({ reach: 50 }), [ enemy('a', 51) ])).toHaveLength(0)
  })

  it('returns only the nearest hit without pierce', () => {
    const hits = resolveBeamHits(beam(), [ enemy('far', 80), enemy('near', 20), enemy('mid', 50) ])
    expect(hits).toHaveLength(1)
    expect(hits[0].candidate.id).toBe('near')
  })

  it('returns every hit, nearest first, with pierce', () => {
    const hits = resolveBeamHits(beam({ pierce: true }), [ enemy('far', 80), enemy('near', 20), enemy('mid', 50) ])
    expect(hits.map(h => h.candidate.id)).toEqual([ 'near', 'mid', 'far' ])
  })

  it('aims at the hull centre, not the chassis origin', () => {
    // A chassis origin sits at the hull's floor. Aiming at it made beams pass
    // under targets that looked square in the reticle.
    const atFloor: HitCandidate = { id: 'a', team: 'blue', position: { x: 0, y: 0, z: 40 }}
    const level   = resolveBeamHits(beam({ origin: { x: 0, y: HULL_CENTRE_Y, z: 0 }, radius: 0.2 }), [ atFloor ])
    expect(level).toHaveLength(1)
  })

  it('works along an arbitrary direction, not just an axis', () => {
    const diagonal = { x: Math.SQRT1_2, y: 0, z: Math.SQRT1_2 }
    const target: HitCandidate = { id: 'a', team: 'blue', position: { x: 30, y: -HULL_CENTRE_Y, z: 30 }}

    expect(resolveBeamHits(beam({ direction: diagonal }), [ target ])).toHaveLength(1)
  })
})

describe('resolveBlastHits', () => {
  it('splashes every hostile inside the radius and nothing outside it', () => {
    const centre = { x: 0, y: 0, z: 0 }
    const inside  = enemy('in', 4)
    const outside = enemy('out', 6)

    const hit = resolveBlastHits(centre, 5, 'red', [ inside, outside ])
    expect(hit.map(c => c.id)).toEqual([ 'in' ])
  })

  it('spares friendlies', () => {
    const friend: HitCandidate = { id: 'f', team: 'red', position: { x: 0, y: -HULL_CENTRE_Y, z: 1 }}
    expect(resolveBlastHits({ x: 0, y: 0, z: 0 }, 10, 'red', [ friend ])).toHaveLength(0)
  })

  it('is spherical, not cylindrical', () => {
    // Splash must fall off with height too, or a missile detonating on the deck
    // kills someone on a plateau directly above it.
    const above: HitCandidate = { id: 'a', team: 'blue', position: { x: 0, y: 20 - HULL_CENTRE_Y, z: 0 }}
    expect(resolveBlastHits({ x: 0, y: 0, z: 0 }, 5, 'red', [ above ])).toHaveLength(0)
  })
})
