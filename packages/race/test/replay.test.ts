/**
 * Race determinism, headless.
 *
 * The property that matters: two runs of one script produce the same hash. The
 * client now PREDICTS this simulation, so if it is not reproducible from an
 * input stream, no amount of reconciliation keeps the two halves in step — a
 * differing hash is the bug to chase before any other.
 */

import { describe, expect, it } from 'vitest'

import { replayRace } from 'Λdev/replay'

import straightLine from '../scenarios/straight-line.json'
import hardCorner from '../scenarios/hard-corner.json'
import respawn from '../scenarios/respawn.json'

import type { RaceReplayScript } from 'Λdev/replay'


const scripts: Array<[string, RaceReplayScript]> = [
  [ 'straight-line', straightLine as RaceReplayScript ],
  [ 'hard-corner', hardCorner as RaceReplayScript ],
  [ 'respawn', respawn as RaceReplayScript ],
]

describe('race replay', () => {
  for (const [ name, script ] of scripts)
    it(`${name} reproduces byte-identically`, async () => {
      const a = await replayRace(script)
      const b = await replayRace(script)
      expect(a.hash).toBe(b.hash)
      expect(a.racers).toEqual(b.racers)
    }, 30_000)

  it('drives forward under throttle rather than sitting still', async () => {
    const result    = await replayRace(straightLine as RaceReplayScript)
    const [ probe ] = result.racers
    expect(Math.hypot(probe.x, probe.z)).toBeGreaterThan(50)
  }, 30_000)

  it('respawns on a resetSeq increment', async () => {
    const result = await replayRace(respawn as RaceReplayScript)
    expect(result.eventCounts.respawn).toBeGreaterThan(0)
  }, 30_000)
})
