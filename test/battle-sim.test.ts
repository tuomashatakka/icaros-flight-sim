import { describe, expect, it } from 'vitest'
import { BattleSim } from '@/engine/battle/sim'
import type { BattleConfig } from '@/engine/battle/sim'
import { apexArena } from '@/engine/battle/arena'
import { calculateActionHash, verifyActionHash } from '@/engine/battle/hash'

/**
 * The headless battle sim, run under vitest. No DOM, no WebSocket: these lock
 * in the game rules (capture, flag carry/score/drop, weapon hits, match end)
 * against real rapier physics. The sim only imports `three` + rapier, so it
 * does not drag the browser into the node test runner.
 */

const STEP = 1 / 60

async function makeSim (overrides: Partial<BattleConfig> = {}) {
  const sim = await BattleSim.create(apexArena(), {
    ...(await import('@/engine/battle/sim')).DEFAULT_BATTLE_CONFIG,
    ...overrides,
  })
  return sim
}

function step (sim: BattleSim, ticks: number) {
  const events: ReturnType<BattleSim['drainEvents']> = []
  for (let i = 0; i < ticks; i++) {
    sim.step(STEP)
    events.push(...sim.drainEvents())
  }
  return events
}

const at = (sim: BattleSim, playerId: string, x: number, z: number, y = 1) => {
  const p = sim.getPlayer(playerId)!
  p.chassis.setTranslation({ x, y, z }, true)
  p.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true)
  p.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true)
}

describe('battle sim boot', () => {
  it('spawns both hovercraft and keeps them stable on the deck', async () => {
    const sim = await makeSim()
    const red  = sim.addPlayer('Paco', 'red', 'icaras')
    const blue = sim.addPlayer('Rico', 'blue', 'icaras')
    sim.start(0)

    const events = step(sim, 180) // 3s of hover
    expect(events.some(e => e.type === 'matchStart')).toBe(true)

    for (const p of [ red, blue ]) {
      const pos = p.chassis.translation()
      expect(Number.isFinite(pos.x)).toBe(true)
      expect(pos.y).toBeGreaterThan(-5) // never fell through the deck
      expect(pos.y).toBeLessThan(20)    // never launched into orbit
    }
  })

  it('is deterministic within the process for a fixed script', async () => {
    const a = await makeSim()
    const b = await makeSim()
    for (const sim of [ a, b ]) {
      for (let i = 0; i < 2; i++) sim.addBot('red')
      for (let i = 0; i < 2; i++) sim.addBot('blue')
      sim.start(0)
    }
    for (let i = 0; i < 1200; i++) {
      a.step(STEP)
      b.step(STEP)
    }
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()))
  })
})

describe('control points', () => {
  it('captures a zone for a lone attacker, then decays to neutral', async () => {
    const sim = await makeSim()
    const attacker = sim.addPlayer('Paco', 'red', 'icaras')
    sim.addPlayer('Rico', 'blue', 'icaras')
    sim.start(0)

    at(sim, attacker.id, 0, 0) // stand in the mid zone
    const events = step(sim, Math.ceil(3 * 60))

    const mid  = sim.zones.find(z => z.def.id === 'mid')!
    const took = events.find(e => e.type === 'zoneChange' && e.id === 'mid' && e.owner === 'red')
    expect(mid.owner).toBe('red')
    expect(mid.progress).toBe(1)
    expect(took?.type).toBe('zoneChange')

    at(sim, attacker.id, -60, -55) // abandon it
    step(sim, Math.ceil(7 * 60))   // decayTime is 6s
    expect(mid.owner).toBeNull()
  })

  it('flips a captured zone to the enemy when they outnumber', async () => {
    const sim = await makeSim()
    const paco = sim.addPlayer('Paco', 'red', 'icaras')
    const invader = sim.addPlayer('Otis', 'blue', 'icaras')
    sim.start(0)

    at(sim, paco.id, 0, 0)
    at(sim, invader.id, 0, -30)
    step(sim, Math.ceil(3 * 60))
    expect(sim.zones.find(z => z.def.id === 'mid')!.owner).toBe('red')

    // Two blues now hold the zone; the tie-break favours the incumbent, so add
    // a second invader to outnumber.
    at(sim, invader.id, 0, 0)
    at(sim, sim.addPlayer('Two', 'blue', 'icaras').id, 0, 5)
    step(sim, Math.ceil(9 * 60))
    expect(sim.zones.find(z => z.def.id === 'mid')!.owner).toBe('blue')
  })
})

describe('flags', () => {
  it('lets a player steal the enemy flag and score it at their own base', async () => {
    const sim = await makeSim()
    const red = sim.addPlayer('Paco', 'red', 'icaras')
    sim.addPlayer('Rico', 'blue', 'icaras')
    sim.start(0)

    at(sim, red.id, 2, 75) // blue flag rest is (0, 1.2, 74)
    let events = step(sim, 5)
    expect(events.some(e => e.type === 'flagTaken' && e.by === red.id)).toBe(true)
    expect(red.carriedFlag).toBe('blue')

    at(sim, red.id, 0, -74) // own base
    events = step(sim, 5)
    const scored = events.find(e => e.type === 'flagScored')
    expect(scored && scored.by === red.id).toBe(true)
    expect(sim.scores.red).toBeGreaterThanOrEqual(3)
    const blueFlag = sim.flags.find(f => f.team === 'blue')!
    expect(blueFlag.state).toBe('home')
    expect(red.carriedFlag).toBeNull()
  })

  it('drops a carried flag when the carrier is hit by a bolt', async () => {
    const sim = await makeSim()
    const red = sim.addPlayer('Paco', 'red', 'icaras')
    const blue = sim.addPlayer('Rico', 'blue', 'icaras')
    sim.start(0)

    at(sim, red.id, 2, 75)
    step(sim, 5) // red grabs the blue flag
    expect(red.carriedFlag).toBe('blue')

    red.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true)
    at(sim, blue.id, 0, 0)

    let hit: ReturnType<BattleSim['drainEvents']>[number] | undefined
    let i = 0
    for (; i < 400; i++) {
      sim.setInput(blue.id, {
        steer: 0, throttle: false, brake: false, boost: false, fire: true, resetSeq: 0,
      })
      sim.step(STEP)
      const ev = sim.drainEvents()
      const h  = ev.find(e => e.type === 'hit' && e.target === red.id)
      if (h) { hit = h; break }
    }

    const blueFlag = sim.flags.find(f => f.team === 'blue')!
    expect(hit).toBeTruthy()
    expect(red.carriedFlag).toBeNull()          // dropped at the moment of impact
    expect(blueFlag.state).toBe('dropped')

    at(sim, red.id, 0, -74)                     // walk away so nothing re-picks it
    step(sim, Math.ceil(6 * 60))                // flagReturnTime is 5s
    expect(blueFlag.state).toBe('home')
  })

  it('returns the enemy flag when the carrier respawns', async () => {
    const sim = await makeSim()
    const red = sim.addPlayer('Paco', 'red', 'icaras')
    sim.addPlayer('Rico', 'blue', 'icaras')
    sim.start(0)

    at(sim, red.id, 2, 75)
    step(sim, 5)
    expect(red.carriedFlag).toBe('blue')

    at(sim, red.id, 0, 0, -50) // drive through the floor -> fall-through respawn
    step(sim, 2)
    expect(red.carriedFlag).toBeNull()
    expect(sim.flags.find(f => f.team === 'blue')!.state).toBe('home')
  })

  it('tags a flag carrier on a fast contact', async () => {
    const sim = await makeSim()
    const red = sim.addPlayer('Paco', 'red', 'icaras')
    const blue = sim.addPlayer('Rico', 'blue', 'icaras')
    sim.start(0)

    at(sim, red.id, 2, 75)
    step(sim, 5)
    expect(red.carriedFlag).toBe('blue')

    // Slam the blue ship into the carrier.
    at(sim, red.id, 0, 0)
    at(sim, blue.id, 0, 30)
    blue.chassis.setLinvel({ x: 0, y: 0, z: -80 }, true)

    const events = step(sim, 30)
    const tag    = events.find(e => e.type === 'tag' && e.target === red.id)
    expect(tag).toBeTruthy()
    expect(red.carriedFlag).toBeNull()
  })
})

describe('match lifecycle', () => {
  it('ends by score target with bots filling the field', async () => {
    const sim = await makeSim({ scoreTarget: 4 })
    sim.addBot('red')
    sim.addPlayer('Paco', 'red', 'icaras')
    sim.addBot('blue')
    sim.addBot('blue')
    sim.start(0)

    const events = step(sim, 240 * 60) // up to 4 sim minutes
    const end    = events.find(e => e.type === 'matchEnd')
    expect(end).toBeTruthy()
    expect(sim.status).toBe('finished')
    const total = sim.scores.red + sim.scores.blue
    expect(total).toBeGreaterThanOrEqual(4)
  })
})

describe('action hash verification', () => {
  it('calculates deterministic action hashes and verifies matching actions', () => {
    const action = {
      tick: 12,
      type: 'FIRE_BOLT',
      payload: { shooterId: 'p1', team: 'red' },
      hash: '',
    }
    const stateSnapshot = { scores: { red: 1, blue: 0 }, status: 'live' }

    const localHash = calculateActionHash(action.type, action.tick, action.payload, stateSnapshot)
    action.hash = localHash

    const result = verifyActionHash(action, stateSnapshot)
    expect(result.matched).toBe(true)
    expect(result.localHash).toBe(localHash)
  })

  it('flags hash mismatch when server action hash differs from local state', () => {
    const action = {
      tick: 12,
      type: 'FIRE_BOLT',
      payload: { shooterId: 'p1', team: 'red' },
      hash: 'badhash123',
    }
    const stateSnapshot = { scores: { red: 1, blue: 0 }, status: 'live' }

    const result = verifyActionHash(action, stateSnapshot)
    expect(result.matched).toBe(false)
  })
})