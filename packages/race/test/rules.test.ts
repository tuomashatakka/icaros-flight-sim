/**
 * The lap rules, which never had a test.
 *
 * They lived inside a zustand store for the whole of the previous
 * implementation, which made them unreachable from a test runner — so the
 * in-order gate enforcement, the sprint-versus-loop finish line, and the
 * exact-instant lap time were all only ever verified by driving the game.
 */

import { describe, expect, it } from 'vitest'

import { createProgress, passCheckpoint, standings, tickProgress } from '../src/rules'
import { buildCheckpoints, crossedGate } from '../src/track'
import { trackBundle } from '../src/levels'

import type { RaceRules } from '../src/rules'
import type { Transform } from '@crash-velocity/physics/types'


const SPAWN: Transform = { position: [ 0, 1, 0 ], quaternion: [ 0, 0, 0, 1 ]}
const gate             = (i: number): Transform => ({ position: [ i, 1, 0 ], quaternion: [ 0, 0, 0, 1 ]})

const loop: RaceRules   = { checkpointCount: 4, laps: 2, loop: true }
const sprint: RaceRules = { checkpointCount: 4, laps: 1, loop: false }

describe('gate ordering', () => {
  it('counts gates only in order, so cutting the course buys nothing', () => {
    const p = createProgress(loop, SPAWN)
    expect(p.nextCheckpoint).toBe(1)

    expect(passCheckpoint(p, 3, gate(3), loop).counted).toBe(false)
    expect(p.gatesCleared).toBe(0)
    expect(p.nextCheckpoint).toBe(1)

    expect(passCheckpoint(p, 1, gate(1), loop).counted).toBe(true)
    expect(p.nextCheckpoint).toBe(2)
  })

  it('moves the respawn target to the gate just cleared', () => {
    const p = createProgress(loop, SPAWN)
    passCheckpoint(p, 1, gate(1), loop)
    expect(p.respawn.position).toEqual([ 1, 1, 0 ])
  })
})

describe('finish line', () => {
  it('is gate 0 on a loop, and closes a lap', () => {
    const p = createProgress(loop, SPAWN)
    tickProgress(p, 10)

    for (const i of [ 1, 2, 3 ])
      expect(passCheckpoint(p, i, gate(i), loop).counted).toBe(true)

    const result = passCheckpoint(p, 0, gate(0), loop)
    expect(result).toMatchObject({ counted: true, lapCompleted: true, finished: false })
    expect(p.lap).toBe(2)
    expect(p.lapTimes).toHaveLength(1)
    expect(p.lapElapsed).toBe(0)
  })

  it('is the LAST gate on a sprint, and ends the race there', () => {
    const p = createProgress(sprint, SPAWN)
    for (const i of [ 1, 2 ])
      passCheckpoint(p, i, gate(i), sprint)

    const result = passCheckpoint(p, 3, gate(3), sprint)
    expect(result).toMatchObject({ counted: true, finished: true })
    expect(p.finished).toBe(true)
    expect(p.finishTime).not.toBeNull()
  })

  it('takes the lap time at the instant of the crossing, not from a mirror', () => {
    const p = createProgress(loop, SPAWN)
    tickProgress(p, 41.5)
    for (const i of [ 1, 2, 3 ])
      passCheckpoint(p, i, gate(i), loop)

    const result = passCheckpoint(p, 0, gate(0), loop)
    expect(result.counted && result.lapTime).toBeCloseTo(41.5, 6)
    expect(p.bestLap).toBeCloseTo(41.5, 6)
  })

  it('refuses everything once finished', () => {
    const p = createProgress(sprint, SPAWN)
    for (const i of [ 1, 2, 3 ])
      passCheckpoint(p, i, gate(i), sprint)

    expect(passCheckpoint(p, 0, gate(0), sprint).counted).toBe(false)
  })
})

describe('standings', () => {
  it('ranks by gates cleared, then by who got there first', () => {
    const make = (id: string, gates: number, elapsed: number) => {
      const progress        = createProgress(loop, SPAWN)
      progress.gatesCleared = gates
      progress.elapsed      = elapsed
      return { id, progress }
    }

    const order = standings([ make('c', 3, 40), make('a', 5, 30), make('b', 5, 20) ])
    expect(order.map(r => r.id)).toEqual([ 'b', 'a', 'c' ])
  })

  it('puts finishers above everyone, ordered by finishing time', () => {
    const make = (id: string, finished: boolean, finishTime: number | null, gates: number) => {
      const progress        = createProgress(loop, SPAWN)
      progress.finished     = finished
      progress.finishTime   = finishTime
      progress.gatesCleared = gates
      return { id, progress }
    }

    const order = standings([ make('slow', true, 90, 8), make('leader', false, null, 99), make('fast', true, 80, 8) ])
    expect(order.map(r => r.id)).toEqual([ 'fast', 'slow', 'leader' ])
  })
})

describe('gate geometry', () => {
  const { spec } = trackBundle('flats')
  const gates    = buildCheckpoints(spec)

  it('builds one gate per waypoint', () => {
    expect(gates).toHaveLength(spec.waypoints.length)
  })

  it('counts a crossing only in the direction of travel', () => {
    const g                                = gates[0]
    const [ fx, fy, fz ]                   = g.forward
    const behind: [number, number, number] = [ g.position[0] - fx * 5, g.position[1] - fy * 5, g.position[2] - fz * 5 ]
    const ahead: [number, number, number]  = [ g.position[0] + fx * 5, g.position[1] + fy * 5, g.position[2] + fz * 5 ]

    expect(crossedGate(g, behind, ahead)).toBe(true)
    expect(crossedGate(g, ahead, behind)).toBe(false)
  })

  it('catches a crossing that steps clean over the plane in one tick', () => {
    // 200 m/s for a 60 Hz tick is 3.3 m — an eight-metre sensor cuboid would
    // have caught this one, but a faster ship would tunnel straight through it.
    const g                              = gates[0]
    const [ fx, fy, fz ]                 = g.forward
    const from: [number, number, number] = [ g.position[0] - fx * 60, g.position[1] - fy * 60, g.position[2] - fz * 60 ]
    const to: [number, number, number]   = [ g.position[0] + fx * 60, g.position[1] + fy * 60, g.position[2] + fz * 60 ]

    expect(crossedGate(g, from, to)).toBe(true)
  })

  it('ignores a pass that misses the gate sideways', () => {
    const g                                = gates[0]
    const [ fx, fy, fz ]                   = g.forward
    const off                              = g.halfWidth + 20
    const behind: [number, number, number] = [ g.position[0] - fx * 5 - fz * off, g.position[1] - fy * 5, g.position[2] - fz * 5 + fx * off ]
    const ahead: [number, number, number]  = [ g.position[0] + fx * 5 - fz * off, g.position[1] + fy * 5, g.position[2] + fz * 5 + fx * off ]

    expect(crossedGate(g, behind, ahead)).toBe(false)
  })
})
