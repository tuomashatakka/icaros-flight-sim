import { Quaternion, Vector3 } from 'three'
import { onPlateau, rampApproach } from './arena'
import { WEAPONS } from './weapons'
import type { BattleInput, BattlePlayer, BattleSim } from './sim'


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

type Waypoint = { x: number; z: number }

/**
 * Stable 32-bit hash (FNV-1a) of a string.
 *
 * Bots need decisions that hold still. Drawing from the shared rng inside a
 * per-tick decision re-rolls it sixty times a second, which is what the old
 * `tick % 240 >= 190 * rng()` did: the goal flipped between the enemy core and
 * a control point every tick, the steer sign flipped with it, and the bot
 * jittered on the spot for an entire match without ever arriving anywhere.
 * Hashing identity + a coarse time block gives a choice that is still varied
 * across the team and still deterministic, but commits for long enough to act
 * on.
 */
function hashOf (text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Ticks a bot sticks with an objective before reconsidering.
 *
 * Has to cover travel plus a capture. On a 600-unit deck a crossing runs 15–20
 * seconds and a point takes another 9 to flip, so a short window means arriving
 * somewhere, starting a capture, and abandoning it — which is exactly what a
 * 12-second window produced: bots on every mesa in the arena and not one zone
 * held between them.
 */
const COMMIT_TICKS = 60 * 25

/**
 * Objective-driven bot controller.
 *
 * Runs INSIDE the sim's tick, so bots are just another input source — identical
 * to a human's. Priorities:
 *   1. fleeing to MY base with the enemy objective
 *   2. grabbing an exposed enemy objective (home or dropped)
 *   3. attacking the nearest zone not fully mine
 *   4. otherwise, hounding the nearest enemy
 *
 * Steering is signed-yaw to the target; throttle is on except when aimed almost
 * backwards. `rng` adds lane jitter so bots don't stack on one bearing. Targets
 * that sit on a mesa are routed via a ramp foot first — a straight seek parks
 * the bot against a cliff, which is the whole reason the arena has ramps.
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

  const goal = routeTo(sim, player, chooseTarget(sim, player, tick))

  _to.set(goal.x - t.x, 0, goal.z - t.z)

  const dist = _to.length()
  if (dist > 1e-3)
    _to.normalize()

  // Ship-forward yaw angle from world +Z, same convention as the vehicle steers.
  const shipYaw   = Math.atan2(_fwd.x, _fwd.z)
  const targetYaw = Math.atan2(_to.x, _to.z)
  let rel         = wrapPi(targetYaw - shipYaw)

  // Jitter: keep a couple of bot's neighbours off the identical bearing.
  rel += (rng() - 0.5) * 0.12

  // NEGATED. `rel` is the signed error in the atan2(x, z) yaw convention, and a
  // POSITIVE `steer` drives that yaw DOWN (the vehicle negates steer once more
  // internally, and +Y rotation reads as a left turn there). Without this the
  // bot turns away from every goal and spirals into the nearest wall — which is
  // exactly what they all did, parked against their own back wall, scoring
  // nothing, on a map big enough for the drift to become obvious.
  const steer  = Math.max(-1, Math.min(1, -rel * 2.2))
  const absRel = Math.abs(rel)
  const aimed  = absRel < 0.6

  // Throttle discipline, tightening as the waypoint gets close.
  //
  // A bot that holds full throttle cannot reach a point at all: at 55 m/s with
  // a 2.4 rad/s yaw ceiling the turning circle is ~23 units, so it orbits its
  // own waypoint forever instead of arriving. Backing off near the goal is what
  // lets it converge — and it is also what lines a ship up with a ramp mouth
  // instead of clipping the mesa beside it.
  const throttle = dist > 60 ? absRel < 1.4 : dist > 20 ? absRel < 1 : absRel < 0.4
  const boost    = absRel < 0.3 && dist > 90

  // Firing is left to the sim's cooldown and lock gates: the bot just states
  // intent. Primary goes down whenever an enemy is roughly ahead and in range;
  // secondary only once the sim says the lock actually completed, so bots pay
  // the same acquisition cost a player does.
  const enemy     = sim.nearestEnemy(player)
  const enemyDist = enemy
    ? Math.hypot(
      enemy.chassis.translation().x - t.x,
      enemy.chassis.translation().z - t.z
    )
    : Number.POSITIVE_INFINITY

  const primary  = WEAPONS[player.loadout.primary]
  const wantFire = enemy !== null && aimed && enemyDist < primary.range * 0.85

  return {
    steer,
    throttle,
    // Braking only helps when the goal is behind or the bot is overshooting a
    // near one: a hovercraft pivots far faster stopped than it does carving a
    // 500-unit circle.
    brake:         !throttle && absRel > 0.9,
    boost:         Boolean(boost),
    fire:          Boolean(wantFire),
    fireSecondary: player.lock.phase === 'locked',
    resetSeq:      player.lastResetSeq,
  }
}

function chooseTarget (
  sim: BattleSim,
  player: BattlePlayer,
  tick: number
): Waypoint {
  const ownBase = sim.arena.bases[player.team].position

  // 1. Escort the stolen core home.
  if (player.carriedFlag)
    return { x: ownBase[0], z: ownBase[2] }

  // 2. Standing on a point that still needs work? Hold it, whatever the commit
  // window says. Walking off a half-captured point resets the whole effort, and
  // a point of ours under contest is about to stop being ours.
  const t = player.chassis.translation()
  for (const zone of sim.zones) {
    const inside  = Math.hypot(t.x - zone.def.position[0], t.z - zone.def.position[2]) <= zone.def.radius
    const settled = zone.owner === player.team && !zone.contested
    if (inside && !settled)
      return { x: zone.def.position[0], z: zone.def.position[2] }
  }

  // Stagger the commit windows across the team so they do not all reconsider
  // on the same tick and swap objectives in lockstep.
  const seat  = hashOf(player.id)
  const block = Math.floor((tick + seat % COMMIT_TICKS) / COMMIT_TICKS)

  // 3. A minority of the team runs the enemy core; the rest take ground. Five
  // control points outscore two cores, so most bots should be on the points.
  const enemyFlag = sim.flags.find(f => f.team !== player.team && f.state === 'dropped')
  const homeFlag  = sim.flags.find(f => f.team !== player.team && f.state === 'home')
  const flag      = enemyFlag ?? homeFlag
  const runCore   = hashOf(`${player.id}:${block}`) % 100 < 25
  if (flag && flag.state !== 'carried' && runCore)
    return { x: flag.position[0], z: flag.position[2] }

  return pickUndefendedZone(sim, player)
}

function pickUndefendedZone (sim: BattleSim, player: BattlePlayer): Waypoint {
  let best: Waypoint | null = null
  let bestScore             = Number.POSITIVE_INFINITY
  const t = player.chassis.translation()

  for (const zone of sim.zones) {
    let score = Math.hypot(zone.def.position[0] - t.x, zone.def.position[2] - t.z)

    // A point already fully ours is worth visiting only if nothing else is
    // closer — but a CONTESTED one of ours jumps the queue.
    if (zone.owner === player.team && zone.progress >= 1)
      score *= zone.contested ? 0.6 : 2.5

    // Per-(bot, zone) bias, constant for the life of the match. Without it
    // every bot on a team ranks the points identically, they all converge on
    // the same one, and a team of three holds exactly one zone.
    score *= 1 + hashOf(player.id + zone.def.id) % 100 / 100 * 0.9

    if (score < bestScore) {
      bestScore = score
      best = { x: zone.def.position[0], z: zone.def.position[2] }
    }
  }

  return best ?? { x: t.x, z: t.z }
}

/**
 * Divert a goal that sits on top of a mesa via one of its ramps.
 *
 * Two stages, not one. Steering at the ramp FOOT gets the bot to the ramp, but
 * once it arrives the foot is zero distance away and the bot just circles it —
 * so inside the handover radius the goal becomes the mesa centre, and the line
 * from a foot to the centre is exactly that ramp's centreline.
 */
function routeTo (sim: BattleSim, player: BattlePlayer, goal: Waypoint): Waypoint {
  const mesa = sim.arena.plateaus.find(p => onPlateau(p, goal.x, goal.z))
  if (!mesa)
    return goal

  const t = player.chassis.translation()
  if (onPlateau(mesa, t.x, t.z) && t.y > mesa.height - 3)
    return goal

  const [ x, z ] = rampApproach(mesa, t.x, t.z)
  return { x, z }
}
