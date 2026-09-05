/**
 * Lag compensation.
 *
 * The unit cases pin the buffer's mechanics; the last one is the point of the
 * whole feature — a shot that lands because the server rewound the target to
 * where the shooter saw it, and would have missed otherwise.
 */
import { describe, expect, it } from 'vitest'
import { BattleSim } from '../src/sim'
import { apexArena } from '../src/arena'
import { REWIND_CLAMP_MS as MAX_REWIND_MS } from '@crash-velocity/net'
import { createBattleRewind } from '../src/rewind'
import type { BattlePlayer } from '../src/sim'


const STEP = 1 / 60

/**
 * The open firing lane at z = -230, behind the red ridges.
 *
 * The obvious setup — both ships on the centreline — buries them inside the
 * Apex Spire, whose footprint is 164×148 around the origin, and then every shot
 * fails line-of-sight for the wrong reason. `test/battle-sim.test.ts` records
 * the same lesson.
 */
const LANE_Z = -230

/** A stand-in with just the fields the buffer reads. */
function fakePlayer (id: string, x: number, y: number, z: number): BattlePlayer {
  return { id, chassis: { translation: () => ({ x, y, z }) }} as unknown as BattlePlayer
}

describe('RewindBuffer', () => {
  it('reads back the pose recorded at a tick', () => {
    const buffer = createBattleRewind(60)
    buffer.record(10, [ fakePlayer('a', 1, 2, 3) ])
    buffer.record(11, [ fakePlayer('a', 4, 5, 6) ])

    expect(buffer.poseSourceAt(10)?.(fakePlayer('a', 0, 0, 0))).toEqual({ x: 1, y: 2, z: 3 })
    expect(buffer.poseSourceAt(11)?.(fakePlayer('a', 0, 0, 0))).toEqual({ x: 4, y: 5, z: 6 })
  })

  it('returns null for a tick it no longer holds', () => {
    // Falling back to live poses is merely unkind to a laggy shooter; resolving
    // against the wrong tick would be a bug nobody could see.
    const buffer = createBattleRewind(60)
    for (let tick = 0; tick < 200; tick++)
      buffer.record(tick, [ fakePlayer('a', tick, 0, 0) ])

    expect(buffer.poseSourceAt(5)).toBeNull()
    expect(buffer.poseSourceAt(199)).not.toBeNull()
  })

  it('keeps about a second of history', () => {
    const buffer = createBattleRewind(60)
    for (let tick = 0; tick < 500; tick++)
      buffer.record(tick, [ fakePlayer('a', tick, 0, 0) ])

    expect(buffer.depth).toBeGreaterThanOrEqual(58)
    expect(buffer.depth).toBeLessThanOrEqual(62)
  })

  it('clamps a rewind to the fairness window', () => {
    const buffer  = createBattleRewind(60)
    const maxBack = Math.round(MAX_REWIND_MS * 60 / 1000)

    // A very laggy shooter is pulled forward to the clamp: beyond it, the
    // correction stops being fair to the target.
    expect(buffer.resolveTick(100, 1_000)).toBe(1_000 - maxBack)

    // A reasonable one is honoured exactly.
    expect(buffer.resolveTick(995, 1_000)).toBe(995)
  })

  it('refuses to rewind into the future', () => {
    // A client claiming to render ahead of the server would otherwise select a
    // tick that does not exist.
    const buffer = createBattleRewind(60)
    expect(buffer.resolveTick(2_000, 1_000)).toBe(1_000)
    expect(buffer.resolveTick(0, 1_000)).toBe(1_000)
    expect(buffer.resolveTick(Number.NaN, 1_000)).toBe(1_000)
  })

  it('falls back to a live pose for a ship missing from the frame', () => {
    // Someone who joined after the frame was recorded was not on the shooter's
    // screen either — but refusing to place them at all would make them
    // permanently unhittable.
    const buffer = createBattleRewind(60)
    buffer.record(10, [ fakePlayer('a', 1, 2, 3) ])

    expect(buffer.poseSourceAt(10)?.(fakePlayer('newcomer', 9, 9, 9))).toEqual({ x: 9, y: 9, z: 9 })
  })
})

describe('lag compensation end to end', () => {
  it('lands a shot that would have missed against the present', async () => {
    const sim    = await BattleSim.create(apexArena())
    const buffer = createBattleRewind(60)

    const shooter = sim.addPlayer('Shooter', 'red', 'icaras')
    const target  = sim.addPlayer('Target', 'blue', 'icaras')

    // Shooter aimed down the lane; target 60 units ahead of it, in the open.
    shooter.chassis.setTranslation({ x: -60, y: 1, z: LANE_Z }, true)
    shooter.chassis.setRotation({ x: 0, y: Math.sin(Math.PI / 4), z: 0, w: Math.cos(Math.PI / 4) }, true)
    target.chassis.setTranslation({ x: 0, y: 1, z: LANE_Z }, true)

    sim.start(0)

    // Record the frame the shooter is looking at, with the target on the beam.
    buffer.record(1, sim.players)

    // Now the target has moved far off the line — this is the present.
    target.chassis.setTranslation({ x: 0, y: 1, z: LANE_Z + 60 }, true)
    buffer.record(2, sim.players)

    const fireOnce = () => {
      shooter.controls = { ...shooter.controls, fire: true, resetSeq: 0 }
      target.controls  = { ...target.controls, resetSeq: 0 }
      sim.step(STEP)
      return sim.drainEvents().filter(e => e.type === 'hit')
    }

    // Against the present: the target is nowhere near the beam.
    sim.lagCompensation = null
    expect(fireOnce()).toHaveLength(0)

    // Rewound to what the shooter saw: it connects. This is the whole feature —
    // "I shot them dead centre and nothing happened" is what its absence feels
    // like.
    shooter.cooldown.primary = 0
    sim.lagCompensation      = who => who.id === shooter.id ? buffer.poseSourceAt(1) : null
    expect(fireOnce().length).toBeGreaterThan(0)

    sim.dispose()
  }, 30_000)

  it('leaves the physics step on present poses', async () => {
    // Rewinding anything but the fire pass would make the world disagree with
    // where it just put things.
    const sim    = await BattleSim.create(apexArena())
    const buffer = createBattleRewind(60)

    const shooter = sim.addPlayer('Shooter', 'red', 'icaras')
    shooter.chassis.setTranslation({ x: -60, y: 1, z: LANE_Z }, true)
    sim.start(0)
    buffer.record(1, sim.players)

    sim.lagCompensation = () => buffer.poseSourceAt(1)
    for (let i = 0; i < 30; i++) {
      shooter.controls = { ...shooter.controls, throttle: true, resetSeq: 0 }
      sim.step(STEP)
    }

    // The ship really moved, so the step used live poses throughout.
    const t = shooter.chassis.translation()
    expect(Math.hypot(t.x + 60, t.z - LANE_Z)).toBeGreaterThan(0.5)

    sim.dispose()
  }, 30_000)
})
