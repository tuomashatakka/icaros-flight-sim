/**
 * Projectiles, spawned from an event rather than streamed as entities.
 *
 * The architecture document is explicit about this and the previous snapshot
 * violated it: every missile in flight was re-sent, position and velocity, in
 * every snapshot at 30 Hz. A salvo of six missiles cost more bandwidth per tick
 * than the six ships that fired them.
 *
 * Instead the server sends ONE compact `ProjectileSpawn` on the reliable
 * channel and both sides integrate the identical trajectory from it — about
 * twenty bytes once, rather than a transform stream per bullet per tick. That
 * is only sound because the fan below is a pure function of the spawn: the
 * spread is index-derived, never drawn from `rng`, so the same event produces
 * the same salvo on every machine that receives it.
 *
 * The client fires optimistically for instant feedback and the server confirms.
 * A mispredicted shot — fired while actually dead or stunned — leaves the
 * client holding a phantom, which it despawns when the confirmation does not
 * arrive. That occasional vanishing projectile is the accepted Overwatch
 * trade, and it is cheaper than waiting a round trip to see your own guns fire.
 */

import { Vector3 } from 'three'

import { WEAPONS } from './weapons'

import type { BattleTeam } from './arena'
import type { Missile } from './types'
import type { WeaponId, WeaponSpec } from './weapons'


/**
 * Everything needed to reproduce a salvo. This is the document's `FireEvent`.
 *
 * `seed` is carried even though the fan is currently deterministic without it,
 * because the moment a weapon wants real scatter it must come from here — a
 * `Math.random()` inside the spawn would desync every client silently.
 */
export type ProjectileSpawn = {
  shooterId:  string;
  team:       BattleTeam;
  weapon:     WeaponId;
  /** First projectile id of the salvo; the rest follow consecutively. */
  firstId:    number;
  origin:     [number, number, number];
  dir:        [number, number, number];
  serverTick: number;
  seed:       number;
  targetId:   string | null;
}

const UP     = new Vector3(0, 1, 0)
const _dir   = new Vector3()
const _fan   = new Vector3()
const _to    = new Vector3()
const _head  = new Vector3()

/**
 * The salvo, as a pure function of the spawn.
 *
 * Index-derived fan, no `rng` — this exact function runs on the server and on
 * every client, and anything that is not a function of the arguments is a
 * desync waiting for a busy firefight.
 */
export function spawnProjectiles (spawn: ProjectileSpawn): Missile[] {
  const spec   = WEAPONS[spawn.weapon]
  const speed  = spec.speed ?? 240
  const spread = spec.spread ?? 0
  const life   = spec.life ?? 3.5
  const out: Missile[] = []

  _dir.set(spawn.dir[0], spawn.dir[1], spawn.dir[2]).normalize()

  for (let i = 0; i < spec.count; i++) {
    const angle = spec.count > 1 ? (i / (spec.count - 1) - 0.5) * 2 * spread : 0
    const lift  = spec.count > 1 ? (i % 2 === 0 ? 1 : -1) * spread * 0.4 : 0

    _fan.copy(_dir)
    _fan.applyAxisAngle(UP, angle)
    _fan.y += lift
    _fan.normalize()

    out.push({
      id:        spawn.firstId + i,
      shooterId: spawn.shooterId,
      team:      spawn.team,
      weapon:    spawn.weapon,
      position:  [ spawn.origin[0], spawn.origin[1], spawn.origin[2] ],
      velocity:  [ _fan.x * speed, _fan.y * speed, _fan.z * speed ],
      life,
      targetId:  spawn.targetId,
    })
  }

  return out
}

/**
 * Turn a missile's heading toward a target, at most `turnRate * dt`.
 *
 * A straight lerp would let the missile slow down mid-turn; keeping it a
 * rotation means the speed stays whatever the rack launched at.
 */
export function homeToward (missile: Missile, target: { x: number; y: number; z: number }, spec: WeaponSpec, dt: number): void {
  _to.set(target.x - missile.position[0], target.y + 0.5 - missile.position[1], target.z - missile.position[2])
  if (_to.lengthSq() <= 1e-6)
    return

  _to.normalize()
  _head.set(missile.velocity[0], missile.velocity[1], missile.velocity[2])

  const speed = _head.length()
  _head.multiplyScalar(1 / Math.max(speed, 1e-6))

  const maxTurn = (spec.turnRate ?? 4) * dt
  const cos     = Math.max(-1, Math.min(1, _head.dot(_to)))
  const angle   = Math.acos(cos)

  if (angle > 1e-4)
    _head.lerp(_to, Math.min(1, maxTurn / angle)).normalize()

  missile.velocity[0] = _head.x * speed
  missile.velocity[1] = _head.y * speed
  missile.velocity[2] = _head.z * speed
}

/** Straight-line advance. Returns false once the missile has outlived its fuse. */
export function advanceProjectile (missile: Missile, dt: number): boolean {
  missile.life -= dt
  missile.position[0] += missile.velocity[0] * dt
  missile.position[1] += missile.velocity[1] * dt
  missile.position[2] += missile.velocity[2] * dt
  return missile.life > 0
}
