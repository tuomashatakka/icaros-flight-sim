import { Quaternion, Vector3 } from 'three'
import type { BattlePlayer } from './sim'
import type { BattleSim } from './sim'
import type { BattleInput } from './sim'


const _fwd  = new Vector3()
const _to   = new Vector3()
const _quat = new Quaternion()

const wrapPi = (a: number) => {
  while (a > Math.PI)
    a -= Math.PI * 2
  while (a < -Math.PI)
    a += Math.PI * 2
  return a
}

/**
 * Objective-driven bot controller.
 *
 * Runs INSIDE the sim's tick, so bots are just another input source — identical
 * to a human's. Priorities:
 *   1. fleeing to MY base with the enemy flag
 *   2. grabbing an exposed enemy flag (home or dropped)
 *   3. attacking the nearest zone not fully mine
 *   4. otherwise, hounding the nearest enemy
 * Steering is signed-yaw to the target; throttle is on except when aimed almost
 * backwards. `rng` adds lane jitter so bots don't stack on one bearing.
 */
export function botInput (
  sim:  BattleSim,
  player: BattlePlayer,
  tick: number,
  rng: () => number,
  dt: number
): BattleInput {
  const t = player.chassis.translation()
  const q = player.chassis.rotation()
  _quat.set(q.x, q.y, q.z, q.w)
  _fwd.set(0, 0, 1).applyQuaternion(_quat)

  const pos      = _to.set(t.x, 0, t.z)
  const target   = chooseTarget(sim, player, rng, tick)
  const throttle = true

  _to.set(target.x - t.x, 0, target.z - t.z)

  const dist = _to.length()
  if (dist > 1e-3)
    _to.normalize()

  // Ship-forward yaw angle from world +Z, same convention as the vehicle steers.
  const shipYaw   = Math.atan2(_fwd.x, _fwd.z)
  const targetYaw = Math.atan2(_to.x, _to.z)
  let rel         = wrapPi(targetYaw - shipYaw)

  // Jitter: keep a couple of bot's neighbours off the identical bearing.
  rel += (rng() - 0.5) * 0.12

  const steer = Math.max(-1, Math.min(1, rel * 2.2))
  const boost = Math.abs(rel) < 0.35
  const aimed = Math.abs(rel) < 0.6

  // Fire: face a nearby enemy and pitch in with a spread so cooldowns aren't
  // wasted shooting a wall of friends.
  const enemy   = sim.nearestEnemy(player)
  const canFire = enemy !== null &&
    aimed &&
    Math.hypot(
      enemy.chassis.translation().x - t.x,
      enemy.chassis.translation().z - t.z
    ) < 70 &&
    player.fireCooldown <= 0

  return {
    steer,
    throttle,
    brake:    !aimed && rel < -0.5,
    boost:    Boolean(boost),
    fire:     Boolean(canFire),
    resetSeq: player.lastResetSeq,
  }
}

type ChooseTargetReturnType = { x: number; z: number }

function chooseTarget (
  sim: BattleSim,
  player: BattlePlayer,
  rng: () => number,
  tick: number
): ChooseTargetReturnType {
  const ownBase = sim.arena.bases[player.team].position

  // 1. Escort the stolen flag home.
  if (player.carriedFlag)
    return { x: ownBase[0], z: ownBase[2] }

  // 2. Grab an exposed enemy flag.
  const enemyFlag = sim.flags.find(f => f.team !== player.team && f.state === 'dropped')
  const homeFlag  = sim.flags.find(f => f.team !== player.team && f.state === 'home')
  const flag      = enemyFlag ?? homeFlag
  if (flag && flag.state !== 'carried') {
    // Occasionally peel off to farm zones instead so the whole team isn't
    // camped on the flag. Deterministic to the sim's seeded rng.
    if (tick % 240 >= 190 * rng())
      return pickUndefendedZone(sim, player)
    return { x: flag.position[0], z: flag.position[2] }
  }

  // 3. Otherwise, take ground.
  return pickUndefendedZone(sim, player)
}

type PickUndefendedZoneReturnType = { x: number; z: number }

function pickUndefendedZone (sim: BattleSim, player: BattlePlayer): PickUndefendedZoneReturnType {
  let best: { x: number; z: number } | null = null
  let bestScore                             = Number.POSITIVE_INFINITY
  const t = player.chassis.translation()

  for (const zone of sim.zones) {
    // If it's fully mine and we're at peace, defend the nearest one instead.
    let score = Math.hypot(zone.def.position[0] - t.x, zone.def.position[2] - t.z)
    if (zone.owner === player.team && zone.progress >= 1)
      score *= 2.5
    if (score < bestScore) {
      bestScore = score
      best = { x: zone.def.position[0], z: zone.def.position[2] }
    }
  }

  return best ?? { x: t.x, z: t.z }
}
