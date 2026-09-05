/**
 * Determinism is the load-bearing property of this whole architecture.
 *
 * The client predicts the server's simulation and reconciles against it. If the
 * server cannot reproduce a match from its input stream, the two cannot agree
 * no matter how good the reconciliation is — so this is the test that fails
 * first when something subtler is wrong.
 *
 * AGENTS.md: two runs of one script that differ is a real bug, and comes before
 * anything else.
 */
import { describe, expect, it } from 'vitest'
import { replayMatch } from 'Ψdev/replay'
import combat from '../scenarios/point-blank.json'
import flight from '../scenarios/straight-fight.json'
import type { ReplayScript } from 'Ψdev/replay'


const COMBAT = combat as ReplayScript
const FLIGHT = flight as ReplayScript

describe('replayMatch', () => {
  it('produces byte-identical results across runs of a flight script', async () => {
    const [ a, b ] = await Promise.all([ replayMatch(FLIGHT), replayMatch(FLIGHT) ])

    expect(a.hash).toBe(b.hash)
    expect(a.players).toEqual(b.players)
    expect(a.eventCounts).toEqual(b.eventCounts)
  }, 30_000)

  it('produces byte-identical results across runs of a combat script', async () => {
    // Combat is the harder case: weapon cooldowns, the lock state machine,
    // missile integration and the seeded rng all have to line up, not just the
    // vehicle step.
    const [ a, b ] = await Promise.all([ replayMatch(COMBAT), replayMatch(COMBAT) ])

    expect(a.hash).toBe(b.hash)
    expect(a.players).toEqual(b.players)
    expect(a.eventCounts).toEqual(b.eventCounts)
  }, 30_000)

  it('actually exercises the combat paths it claims to', async () => {
    // A determinism test that reproduces "nothing happened" proves nothing. The
    // first version of this scenario put both ships inside the Apex Spire, fired
    // 204 shots and landed zero hits — deterministically.
    const result = await replayMatch(COMBAT)

    expect(result.eventCounts.fire).toBeGreaterThan(0)
    expect(result.eventCounts.hit).toBeGreaterThan(0)
    expect(result.eventCounts.kill).toBeGreaterThan(0)
    expect(result.eventCounts.lock).toBeGreaterThan(0)
  }, 30_000)

  it('is sensitive to a changed input, not just stable', async () => {
    // The counterpart to the tests above: a hash that never changes would pass
    // them while proving nothing about the simulation.
    const nudged: ReplayScript = {
      ...FLIGHT,
      timeline: [ ...FLIGHT.timeline, { tick: 200, player: 0, input: { steer: -0.9 }}],
    }

    const [ base, changed ] = await Promise.all([ replayMatch(FLIGHT), replayMatch(nudged) ])
    expect(changed.hash).not.toBe(base.hash)
  }, 30_000)

  it('holds a scripted input until the next entry for that player', async () => {
    const held = await replayMatch({
      name:     'held-throttle',
      ticks:    120,
      players:  [{ name: 'R', team: 'red' }],
      timeline: [{ tick: 10, player: 0, input: { throttle: true }}],
    })

    const idle = await replayMatch({
      name:     'idle',
      ticks:    120,
      players:  [{ name: 'R', team: 'red' }],
      timeline: [],
    })

    // A held throttle has to move the ship; if inputs were applied for one tick
    // and dropped, these two would land in the same place.
    const moved = Math.hypot(held.players[0].x - idle.players[0].x, held.players[0].z - idle.players[0].z)
    expect(moved).toBeGreaterThan(1)
  }, 30_000)
})
