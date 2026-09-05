import { describe, expect, it } from 'vitest'
import { AIM_MAX, BattleSim, DEFAULT_BATTLE_CONFIG, NEUTRAL_INPUT } from '../src/sim'
import type { BattleConfig, BattlePlayer } from '../src/sim'
import { apexArena, onPlateau, plateauColliders, rampFeet } from '../src/arena'
import { LOCK, WEAPONS } from '../src/weapons'

/**
 * The headless battle sim, run under vitest. No DOM, no WebSocket: these lock
 * in the game rules (capture, objective carry/score/drop, weapon hits, match
 * end) against real rapier physics. The sim only imports `three` + rapier, so
 * it does not drag the browser into the node test runner.
 *
 * Positions are read from the arena rather than hard-coded — the deck grew 9×
 * once already, and every hard-coded coordinate in here failed silently as a
 * "rule broke" when in fact only the map had moved.
 */

const STEP  = 1 / 60
const ARENA = apexArena()

async function makeSim (overrides: Partial<BattleConfig> = {}) {
  return BattleSim.create(apexArena(), { ...DEFAULT_BATTLE_CONFIG, ...overrides })
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

/** Point `shooter` straight at `target`, on the XZ plane. Ship-forward is +z. */
function aimAt (shooter: BattlePlayer, target: BattlePlayer) {
  const s   = shooter.chassis.translation()
  const t   = target.chassis.translation()
  const yaw = Math.atan2(t.x - s.x, t.z - s.z)
  shooter.chassis.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true)
}

const hold = (sim: BattleSim, id: string, over: Partial<typeof NEUTRAL_INPUT> = {}) =>
  sim.setInput(id, { ...NEUTRAL_INPUT, ...over })

const zoneOf = (sim: BattleSim, id: string) => sim.zones.find(z => z.def.id === id)!

/**
 * An open firing lane on the deck.
 *
 * The central spire's footprint is 164×148 around the origin, so the obvious
 * "put both ships on the centreline" setup buries them INSIDE a mesa and every
 * line-of-sight test fails for the wrong reason. This strip — behind the red
 * ridges, in front of the spawn line — is clear of every plateau, ramp and
 * cover block.
 */
const LANE_Z         = -230
const SPIRE          = ARENA.controlPoints.find(c => c.id === 'spire')!
const BLUE_FLAG_REST = ARENA.bases.blue.flagRest
const RED_BASE       = ARENA.bases.red.position

describe('arena geometry', () => {
  it('is at least 8× the original 200×200 deck', () => {
    expect((ARENA.half * 2) ** 2).toBeGreaterThanOrEqual(8 * 200 * 200)
  })

  it('has five symmetric plateaus, each with two ramps', () => {
    expect(ARENA.plateaus).toHaveLength(5)
    for (const p of ARENA.plateaus)
      expect(p.ramps).toHaveLength(2)

    // Two per side plus one on the centreline.
    const red  = ARENA.plateaus.filter(p => p.centre[1] < -1)
    const blue = ARENA.plateaus.filter(p => p.centre[1] > 1)
    const mid  = ARENA.plateaus.filter(p => Math.abs(p.centre[1]) <= 1)
    expect(red).toHaveLength(2)
    expect(blue).toHaveLength(2)
    expect(mid).toHaveLength(1)

    // Every red-side mesa has a blue mirror image through the origin.
    for (const p of red)
      expect(blue.some(b =>
        Math.abs(b.centre[0] + p.centre[0]) < 1e-6 &&
        Math.abs(b.centre[1] + p.centre[1]) < 1e-6 &&
        b.height === p.height)).toBe(true)
  })

  it('lands every ramp exactly on its mesa edge and on the deck', () => {
    for (const p of ARENA.plateaus) {
      const feet = rampFeet(p)
      for (const [ fx, fz ] of feet) {
        // A ramp foot is outside the footprint (you drive onto it from the deck)
        // and inside the walls.
        expect(onPlateau(p, fx, fz)).toBe(false)
        expect(Math.abs(fx)).toBeLessThan(ARENA.half)
        expect(Math.abs(fz)).toBeLessThan(ARENA.half)
      }
      // Mesa slab + one wedge per ramp.
      expect(plateauColliders(p)).toHaveLength(1 + p.ramps.length)
    }
  })

  it('walls the deck in on all four sides', () => {
    const tall = ARENA.colliders.filter(c => c.position[1] + c.args[1] > 20)
    expect(tall.length).toBeGreaterThanOrEqual(4)

    // One wall per side, each reaching high enough that a ramp launch cannot
    // clear it, and each closing its whole side.
    for (const [ axis, sign ] of [[ 0, 1 ], [ 0, -1 ], [ 2, 1 ], [ 2, -1 ]] as Array<[0 | 2, 1 | -1]>) {
      const wall = tall.find(c => Math.sign(c.position[axis]) === sign && Math.abs(c.position[axis]) > ARENA.half - 20)
      expect(wall, `wall on axis ${axis} sign ${sign}`).toBeTruthy()
      expect(wall!.position[1] + wall!.args[1]).toBeGreaterThan(40)
      expect(wall!.args[axis === 0 ? 2 : 0]).toBeGreaterThanOrEqual(ARENA.half)
    }
  })
})

describe('battle sim boot', () => {
  it('spawns both hovercraft and keeps them stable on the deck', async () => {
    const sim  = await makeSim()
    const red  = sim.addPlayer('Paco', 'red', 'icaras')
    const blue = sim.addPlayer('Rico', 'blue', 'icaras')
    sim.start(0)

    const events = step(sim, 180) // 3s of hover
    expect(events.some(e => e.type === 'matchStart')).toBe(true)

    for (const p of [ red, blue ]) {
      const pos = p.chassis.translation()
      expect(Number.isFinite(pos.x)).toBe(true)
      expect(pos.y).toBeGreaterThan(-5) // never fell through the deck
      expect(pos.y).toBeLessThan(20) // never launched into orbit
    }
  })

  it('is deterministic within the process for a fixed script', async () => {
    const a = await makeSim()
    const b = await makeSim()
    for (const sim of [ a, b ]) {
      for (let i = 0; i < 2; i++)
        sim.addBot('red')
      for (let i = 0; i < 2; i++)
        sim.addBot('blue')
      sim.start(0)
    }
    for (let i = 0; i < 1200; i++) {
      a.step(STEP)
      b.step(STEP)
    }
    expect(JSON.stringify(a.snapshot())).toBe(JSON.stringify(b.snapshot()))
  })

  it('drives a hovercraft up a ramp and onto the mesa', async () => {
    const sim  = await makeSim()
    const mesa = ARENA.plateaus.find(p => p.id === 'spire')!
    const p    = sim.addPlayer('Climber', 'red', 'icaras')
    sim.start(0)

    // Park at the foot of a ramp, pointing up it, and hold the throttle.
    const [ fx, fz ] = rampFeet(mesa)[0]
    const toMesa     = Math.atan2(mesa.centre[0] - fx, mesa.centre[1] - fz)
    at(sim, p.id, fx, fz, 2)
    p.chassis.setRotation({ x: 0, y: Math.sin(toMesa / 2), z: 0, w: Math.cos(toMesa / 2) }, true)

    // Assert it ever GOT up there, not where it ended: the mesa is 148 long and
    // eight seconds of throttle drives straight over it and down the far ramp.
    let reachedTop = false
    for (let i = 0; i < 60 * 8 && !reachedTop; i++) {
      hold(sim, p.id, { throttle: true })
      sim.step(STEP)
      sim.drainEvents()

      const pos = p.chassis.translation()
      reachedTop = onPlateau(mesa, pos.x, pos.z) && pos.y > mesa.height - 2
    }

    expect(reachedTop).toBe(true)
  })
})

describe('lock-on', () => {
  /** Face a stationary enemy from `dist` metres, offset by `offsetDeg` off-axis. */
  async function rig (dist: number, offsetDeg = 0) {
    const sim   = await makeSim()
    const me    = sim.addPlayer('Me', 'red', 'icaras')
    const enemy = sim.addPlayer('Them', 'blue', 'icaras')
    sim.start(0)

    at(sim, me.id, -dist / 2, LANE_Z, 1)
    at(sim, enemy.id, dist / 2, LANE_Z, 1)
    aimAt(me, enemy)
    expect(sim.hasLineOfSight(me, enemy)).toBe(true)

    return { sim, me, enemy, offsetDeg }
  }

  /**
   * Re-pin the shooter's heading every tick.
   *
   * The hover controller writes angular velocity each step to hold the ship
   * level, so a rotation set once has drifted by the time a 2-second lock
   * completes — which reads as "the lock is broken" rather than "the test is".
   */
  function holdAim (sim: BattleSim, me: BattlePlayer, enemy: BattlePlayer, ticks: number, offsetDeg = 0) {
    // Down the lane is +x, i.e. yaw = +90°, plus whatever offset the case wants.
    const yaw = (90 + offsetDeg) * Math.PI / 180
    for (let i = 0; i < ticks; i++) {
      me.chassis.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true)
      me.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true)
      enemy.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true)
      sim.step(STEP)
      sim.drainEvents()
    }
  }

  it('takes real time to acquire — no instant lock', async () => {
    const { sim, me, enemy } = await rig(120)

    holdAim(sim, me, enemy, 6)
    expect(me.lock.phase).toBe('tracking')
    expect(me.lock.progress).toBeLessThan(0.2)

    // Half the acquisition window: tracking, still not locked.
    holdAim(sim, me, enemy, Math.round(LOCK.time * 60 * 0.5))
    expect(me.lock.phase).toBe('tracking')

    holdAim(sim, me, enemy, Math.round(LOCK.time * 60 * 0.6) + 10)
    expect(me.lock.phase).toBe('locked')
    expect(me.lock.targetId).toBe(enemy.id)
  })

  it('never fills while the target sits outside the acquisition cone', async () => {
    const { sim, me, enemy } = await rig(120)

    // 11° off-axis: inside the hold ring, outside the cone that fills.
    holdAim(sim, me, enemy, Math.round(LOCK.time * 60 * 2), 11)
    expect(me.lock.phase).not.toBe('locked')
    expect(me.lock.progress).toBeLessThan(0.2)
  })

  it('bleeds the meter away when the crosshair slides off mid-acquisition', async () => {
    const { sim, me, enemy } = await rig(120)

    holdAim(sim, me, enemy, Math.round(LOCK.time * 60 * 0.7))

    const peak = me.lock.progress
    expect(peak).toBeGreaterThan(0.3)

    // Swing well outside the hold ring and wait out the slip grace.
    holdAim(sim, me, enemy, 90, 45)
    expect(me.lock.progress).toBeLessThan(peak)
    expect(me.lock.phase).not.toBe('locked')
  })

  it('drops a target that goes out of range', async () => {
    const { sim, me, enemy } = await rig(120)
    holdAim(sim, me, enemy, 30)
    expect(me.lock.targetId).toBe(enemy.id)

    at(sim, enemy.id, LOCK.range + 60, LANE_Z, 1)
    holdAim(sim, me, enemy, 30)
    expect(me.lock.phase).toBe('idle')
  })

  it('will not lock through a mesa', async () => {
    const sim   = await makeSim()
    const me    = sim.addPlayer('Me', 'red', 'icaras')
    const enemy = sim.addPlayer('Them', 'blue', 'icaras')
    sim.start(0)

    // Straight through the central spire: same x, opposite sides of it.
    at(sim, me.id, 0, -140, 1)
    at(sim, enemy.id, 0, 140, 1)
    aimAt(me, enemy)

    for (let i = 0; i < Math.round(LOCK.time * 60 * 2); i++) {
      me.chassis.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)
      sim.step(STEP)
      sim.drainEvents()
    }
    expect(sim.hasLineOfSight(me, enemy)).toBe(false)
    expect(me.lock.phase).not.toBe('locked')
  })
})

describe('vertical aim', () => {
  /** Park a stationary enemy `elevationDeg` above the shooter's own eye line. */
  async function elevated (elevationDeg: number, dist = 120) {
    const sim   = await makeSim()
    const me    = sim.addPlayer('Me', 'red', 'icaras')
    const enemy = sim.addPlayer('Them', 'blue', 'icaras')
    sim.start(0)

    at(sim, me.id, -dist / 2, LANE_Z, 1)
    at(sim, enemy.id, dist / 2, LANE_Z, 1 + dist * Math.tan(elevationDeg * Math.PI / 180))
    return { sim, me, enemy }
  }

  /**
   * Pin the shooter's yaw AND the target's altitude every tick.
   *
   * Same reason as `holdAim` above, plus one more: a target parked in mid-air
   * falls, and a lock that dies because the enemy hit the deck reads as "the
   * aim did not reach" rather than "the test did not hold it there".
   */
  function hover (sim: BattleSim, me: BattlePlayer, enemy: BattlePlayer, ticks: number, aimPitch = 0) {
    const yaw  = 90 * Math.PI / 180
    const rest = enemy.chassis.translation()
    for (let i = 0; i < ticks; i++) {
      me.chassis.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true)
      me.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true)
      enemy.chassis.setTranslation(rest, true)
      enemy.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true)
      hold(sim, me.id, { aimPitch })
      sim.step(STEP)
      sim.drainEvents()
    }
  }

  it('trims upward while R is held and stops at the clamp', async () => {
    const { sim, me, enemy } = await elevated(18)

    hover(sim, me, enemy, 12, 1)

    const partway = me.aimAngle
    expect(partway).toBeGreaterThan(0)
    expect(partway).toBeLessThan(AIM_MAX)

    hover(sim, me, enemy, 120, 1)
    expect(me.aimAngle).toBeCloseTo(AIM_MAX, 5)
  })

  it('holds the trim where you leave it instead of springing back', async () => {
    const { sim, me, enemy } = await elevated(18)

    hover(sim, me, enemy, 20, 1)

    const held = me.aimAngle

    hover(sim, me, enemy, 60, 0)
    expect(me.aimAngle).toBeCloseTo(held, 6)
  })

  it('cannot reach a target 18° overhead until the aim is raised', async () => {
    const { sim, me, enemy } = await elevated(18)

    // Level: the target sits outside even the hold ring, so nothing acquires.
    hover(sim, me, enemy, Math.round(LOCK.time * 60 * 1.6), 0)
    expect(me.lock.phase).toBe('idle')
    expect(me.lock.progress).toBeLessThan(0.05)
  })

  it('acquires that same target once R walks the aim up to it', async () => {
    const { sim, me, enemy } = await elevated(18)

    hover(sim, me, enemy, Math.round(LOCK.time * 60 * 1.6) + 40, 1)
    expect(me.lock.phase).toBe('locked')
    expect(me.lock.targetId).toBe(enemy.id)
  })

  it('sends a free-aim beam above the horizon when trimmed up', async () => {
    const { sim, me, enemy } = await elevated(18)

    hover(sim, me, enemy, 60, 1)
    hold(sim, me.id, { aimPitch: 1, fire: true })
    step(sim, 2)

    const shot = sim.beams.find(b => b.shooterId === me.id)
    expect(shot).toBeDefined()
    expect(shot!.to[1]).toBeGreaterThan(shot!.from[1])
  })

  it('drops the trim back to level on respawn', async () => {
    const { sim, me, enemy } = await elevated(18)

    hover(sim, me, enemy, 60, 1)
    expect(me.aimAngle).toBeGreaterThan(0)

    hold(sim, me.id, { resetSeq: 1 })
    step(sim, 2)
    expect(me.aimAngle).toBe(0)
  })
})

describe('weapons', () => {
  it('a beam weapon is hitscan and needs no lock', async () => {
    const sim   = await makeSim()
    const me    = sim.addPlayer('Me', 'red', 'icaras', { primary: 'pulse', secondary: 'hornet' })
    const enemy = sim.addPlayer('Them', 'blue', 'icaras')
    sim.start(0)

    at(sim, me.id, -40, LANE_Z, 1)
    at(sim, enemy.id, 40, LANE_Z, 1)
    aimAt(me, enemy)

    const before = enemy.health
    hold(sim, me.id, { fire: true })
    sim.step(STEP)

    const events = sim.drainEvents()

    // One tick: the shot has already resolved 80 m away.
    expect(events.some(e => e.type === 'fire' && e.weapon === 'pulse')).toBe(true)
    expect(events.some(e => e.type === 'hit' && e.target === enemy.id)).toBe(true)
    expect(enemy.health).toBe(before - WEAPONS.pulse.damage)
    expect(sim.beams).toHaveLength(1)
  })

  it('a beam stops at arena geometry instead of shooting through a mesa', async () => {
    const sim   = await makeSim()
    const me    = sim.addPlayer('Me', 'red', 'icaras', { primary: 'lance', secondary: 'hornet' })
    const enemy = sim.addPlayer('Them', 'blue', 'icaras')
    sim.start(0)

    at(sim, me.id, 0, -140, 1)
    at(sim, enemy.id, 0, 140, 1)
    me.chassis.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true)

    const before = enemy.health
    hold(sim, me.id, { fire: true })
    sim.step(STEP)
    sim.drainEvents()

    expect(enemy.health).toBe(before)
    expect(sim.beams[0]?.hit).toBe(false)
  })

  it('holds a missile back until the lock completes, then flies it fast', async () => {
    const sim   = await makeSim()
    const me    = sim.addPlayer('Me', 'red', 'icaras', { primary: 'pulse', secondary: 'hornet' })
    const enemy = sim.addPlayer('Them', 'blue', 'icaras')
    sim.start(0)

    const east = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 } // yaw +90°, forward = +x
    at(sim, me.id, -60, LANE_Z, 1)
    at(sim, enemy.id, 60, LANE_Z, 1)

    // Trigger held from tick one — nothing launches while the meter fills.
    for (let i = 0; i < 20; i++) {
      hold(sim, me.id, { fireSecondary: true })
      me.chassis.setRotation(east, true)
      sim.step(STEP)
      sim.drainEvents()
    }
    expect(me.lock.phase).not.toBe('locked')
    expect(sim.missiles).toHaveLength(0)

    let launched = 0
    for (let i = 0; i < Math.round(LOCK.time * 60) + 90; i++) {
      hold(sim, me.id, { fireSecondary: true })
      me.chassis.setRotation(east, true)
      enemy.chassis.setTranslation({ x: 60, y: 1, z: LANE_Z }, true)
      sim.step(STEP)
      launched += sim.drainEvents().filter(e => e.type === 'fire' && e.weapon === 'hornet').length
      if (enemy.health < enemy.maxHealth)
        break
    }

    expect(launched).toBeGreaterThan(0)
    expect(enemy.health).toBeLessThan(enemy.maxHealth)
  })

  it('fans a swarm rack into several warheads off one lock', async () => {
    const sim   = await makeSim()
    const me    = sim.addPlayer('Me', 'red', 'icaras', { primary: 'pulse', secondary: 'swarm' })
    const enemy = sim.addPlayer('Them', 'blue', 'icaras')
    sim.start(0)

    at(sim, me.id, -50, LANE_Z, 1)
    at(sim, enemy.id, 50, LANE_Z, 1)

    const east = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 }
    for (let i = 0; i < Math.round(LOCK.time * 60) + 6; i++) {
      me.chassis.setRotation(east, true)
      me.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true)
      sim.step(STEP)
      sim.drainEvents()
    }
    expect(me.lock.phase).toBe('locked')

    hold(sim, me.id, { fireSecondary: true })
    sim.step(STEP)
    sim.drainEvents()
    expect(sim.missiles.length).toBe(WEAPONS.swarm.count)
  })

  it('respects the per-slot cooldown', async () => {
    const sim = await makeSim()
    const me  = sim.addPlayer('Me', 'red', 'icaras', { primary: 'lance', secondary: 'hornet' })
    sim.addPlayer('Them', 'blue', 'icaras')
    sim.start(0)

    let shots = 0
    for (let i = 0; i < 60; i++) {
      hold(sim, me.id, { fire: true })
      sim.step(STEP)
      shots += sim.drainEvents().filter(e => e.type === 'fire').length
    }
    // One second of held trigger at a 0.72 s cooldown is two shots, not sixty.
    expect(shots).toBeLessThanOrEqual(2)
    expect(shots).toBeGreaterThanOrEqual(1)
  })
})

describe('control points', () => {
  it('captures slowly for the team that outnumbers, then STAYS captured', async () => {
    const sim      = await makeSim()
    const attacker = sim.addPlayer('Paco', 'red', 'icaras')
    sim.addPlayer('Rico', 'blue', 'icaras')
    sim.start(0)

    const spire = zoneOf(sim, 'spire')
    at(sim, attacker.id, SPIRE.position[0], SPIRE.position[2], SPIRE.position[1] + 2)

    // Halfway through the capture window it must NOT be captured yet.
    step(sim, Math.round(ARENA.captureTime * 60 * 0.5))
    expect(spire.owner).toBeNull()
    expect(spire.progress).toBeGreaterThan(0.2)

    const events = step(sim, Math.round(ARENA.captureTime * 60 * 0.6))
    expect(spire.owner).toBe('red')
    expect(events.some(e => e.type === 'zoneChange' && e.id === 'spire' && e.owner === 'red')).toBe(true)

    // Walk away: a held point does not decay on its own any more.
    at(sim, attacker.id, -250, -250)
    step(sim, Math.round(ARENA.captureTime * 60 * 4))
    expect(spire.owner).toBe('red')
    expect(spire.progress).toBe(1)
  })

  it('only starts losing a point once an opponent drives into the circle', async () => {
    const sim     = await makeSim()
    const holder  = sim.addPlayer('Paco', 'red', 'icaras')
    const invader = sim.addPlayer('Otis', 'blue', 'icaras')
    sim.start(0)

    const spire = zoneOf(sim, 'spire')
    at(sim, holder.id, SPIRE.position[0], SPIRE.position[2], SPIRE.position[1] + 2)
    at(sim, invader.id, -250, 250)
    step(sim, Math.round(ARENA.captureTime * 60 * 1.2))
    expect(spire.owner).toBe('red')

    // Holder leaves, nobody contests: still red.
    at(sim, holder.id, -250, -250)
    step(sim, 120)
    expect(spire.owner).toBe('red')
    expect(spire.contested).toBe(false)

    // Invader arrives: the meter starts draining and the point eventually flips.
    at(sim, invader.id, SPIRE.position[0], SPIRE.position[2], SPIRE.position[1] + 2)
    step(sim, Math.round(ARENA.contestDrain * 60 * 1.2))
    expect(spire.owner).toBeNull()

    step(sim, Math.round(ARENA.captureTime * 60 * 1.2))
    expect(spire.owner).toBe('blue')
  })

  it('freezes on an even contest and resolves for whoever brings more bodies', async () => {
    const sim  = await makeSim()
    const red  = sim.addPlayer('Paco', 'red', 'icaras')
    const blue = sim.addPlayer('Otis', 'blue', 'icaras')
    sim.start(0)

    const spire = zoneOf(sim, 'spire')
    const stand = (p: BattlePlayer, dx: number) =>
      at(sim, p.id, SPIRE.position[0] + dx, SPIRE.position[2], SPIRE.position[1] + 2)

    stand(red, -6)
    stand(blue, 6)
    step(sim, Math.round(ARENA.captureTime * 60 * 2))
    expect(spire.owner).toBeNull()
    expect(spire.progress).toBeLessThan(0.1)
    expect(spire.contested).toBe(true)

    // Second red tips the balance.
    stand(sim.addPlayer('Two', 'red', 'icaras'), 12)
    step(sim, Math.round(ARENA.captureTime * 60 * 1.5))
    expect(spire.owner).toBe('red')
  })
})

describe('objectives', () => {
  it('lets a player steal the enemy core and score it at their own base', async () => {
    const sim = await makeSim()
    const red = sim.addPlayer('Paco', 'red', 'icaras')
    sim.addPlayer('Rico', 'blue', 'icaras')
    sim.start(0)

    at(sim, red.id, BLUE_FLAG_REST[0] + 2, BLUE_FLAG_REST[2] + 1)

    let events = step(sim, 5)
    expect(events.some(e => e.type === 'flagTaken' && e.by === red.id)).toBe(true)
    expect(red.carriedFlag).toBe('blue')

    at(sim, red.id, RED_BASE[0], RED_BASE[2])
    events = step(sim, 5)

    const scored = events.find(e => e.type === 'flagScored')
    expect(scored && scored.by === red.id).toBe(true)
    expect(sim.scores.red).toBeGreaterThanOrEqual(DEFAULT_BATTLE_CONFIG.captureBonus)
    expect(sim.flags.find(f => f.team === 'blue')!.state).toBe('home')
    expect(red.carriedFlag).toBeNull()
  })

  it('drops a carried core when the carrier is shot', async () => {
    const sim  = await makeSim()
    const red  = sim.addPlayer('Paco', 'red', 'icaras')
    const blue = sim.addPlayer('Rico', 'blue', 'icaras', { primary: 'pulse', secondary: 'hornet' })
    sim.start(0)

    at(sim, red.id, BLUE_FLAG_REST[0] + 2, BLUE_FLAG_REST[2] + 1)
    step(sim, 5)
    expect(red.carriedFlag).toBe('blue')

    at(sim, red.id, 40, LANE_Z)
    at(sim, blue.id, -40, LANE_Z)
    aimAt(blue, red)

    hold(sim, blue.id, { fire: true })
    sim.step(STEP)

    const events = sim.drainEvents()

    expect(events.some(e => e.type === 'hit' && e.target === red.id)).toBe(true)
    expect(red.carriedFlag).toBeNull()
    expect(sim.flags.find(f => f.team === 'blue')!.state).toBe('dropped')

    at(sim, red.id, RED_BASE[0], RED_BASE[2]) // walk away so nothing re-picks it
    step(sim, Math.ceil((ARENA.flagReturnTime + 1) * 60))
    expect(sim.flags.find(f => f.team === 'blue')!.state).toBe('home')
  })

  it('returns the enemy core when the carrier respawns', async () => {
    const sim = await makeSim()
    const red = sim.addPlayer('Paco', 'red', 'icaras')
    sim.addPlayer('Rico', 'blue', 'icaras')
    sim.start(0)

    at(sim, red.id, BLUE_FLAG_REST[0] + 2, BLUE_FLAG_REST[2] + 1)
    step(sim, 5)
    expect(red.carriedFlag).toBe('blue')

    at(sim, red.id, 0, 0, -50) // drive through the floor -> fall-through respawn
    step(sim, 2)
    expect(red.carriedFlag).toBeNull()
    expect(sim.flags.find(f => f.team === 'blue')!.state).toBe('home')
  })

  it('tags a core carrier on a fast contact', async () => {
    const sim  = await makeSim()
    const red  = sim.addPlayer('Paco', 'red', 'icaras')
    const blue = sim.addPlayer('Rico', 'blue', 'icaras')
    sim.start(0)

    at(sim, red.id, BLUE_FLAG_REST[0] + 2, BLUE_FLAG_REST[2] + 1)
    step(sim, 5)
    expect(red.carriedFlag).toBe('blue')

    // Slam the blue ship into the carrier.
    at(sim, red.id, 0, LANE_Z)
    at(sim, blue.id, 0, LANE_Z + 30)
    blue.chassis.setLinvel({ x: 0, y: 0, z: -80 }, true)

    const events = step(sim, 30)
    expect(events.some(e => e.type === 'tag' && e.target === red.id)).toBe(true)
    expect(red.carriedFlag).toBeNull()
  })
})

describe('match lifecycle', () => {
  it('ends by score target with bots filling the field', async () => {
    const sim = await makeSim({ scoreTarget: 4, matchTime: 600 })
    sim.addBot('red')
    sim.addPlayer('Paco', 'red', 'icaras')
    sim.addBot('blue')
    sim.addBot('blue')
    sim.start(0)

    const events = step(sim, 420 * 60) // up to 7 sim minutes
    expect(events.find(e => e.type === 'matchEnd')).toBeTruthy()
    expect(sim.status).toBe('finished')
    expect(sim.scores.red + sim.scores.blue).toBeGreaterThanOrEqual(4)
  })

  it('ends on the clock when nobody reaches the target', async () => {
    const sim = await makeSim({ matchTime: 5, scoreTarget: 9999 })
    sim.addPlayer('Paco', 'red', 'icaras')
    sim.addPlayer('Rico', 'blue', 'icaras')
    sim.start(0)

    const events = step(sim, 6 * 60)
    expect(events.some(e => e.type === 'matchEnd')).toBe(true)
    expect(sim.status).toBe('finished')
  })
})
