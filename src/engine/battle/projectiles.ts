/**
 * The client's copy of every missile in flight.
 *
 * Projectiles are no longer networked entities — the server sends one compact
 * fire event and both sides integrate the identical trajectory from it, which
 * is the architecture document's recommendation and about twenty bytes instead
 * of a transform stream per bullet per tick.
 *
 * The client spawns OPTIMISTICALLY on its own trigger, so guns answer without
 * waiting a round trip, and reconciles when the server's confirmation arrives.
 * Two things follow from that, and both are deliberate:
 *
 * - A shot the server never confirms is a misprediction (fired while actually
 *   dead or stunned) and its phantom is dropped. That occasional vanishing
 *   projectile is the accepted Overwatch trade.
 * - A confirmed salvo REPLACES the optimistic one rather than adding to it,
 *   matched on the shooter and weapon, or every shot would draw twice.
 */

import { advanceProjectile, homeToward, spawnProjectiles } from '@crash-velocity/battle/projectiles'
import { WEAPONS } from '@crash-velocity/battle/weapons'

import type { ProjectileSpawn } from '@crash-velocity/battle/projectiles'
import type { Missile } from '@crash-velocity/battle/types'


/** How long an unconfirmed local salvo is drawn before it is written off. */
const OPTIMISTIC_TTL = 0.4

type Tracked = {
  missile: Missile;

  /** Seconds until an unconfirmed shot is dropped; Infinity once confirmed. */
  grace: number;
}

export type PoseSource = (playerId: string) => { x: number; y: number; z: number } | null

export class ProjectileField {
  private tracked: Tracked[] = []

  /** Spawn from a server-confirmed event. */
  confirm (spawn: ProjectileSpawn): void {
    // Drop the optimistic copy this confirms, matched on shooter + weapon.
    this.tracked = this.tracked.filter(t =>
      t.grace === Infinity || t.missile.shooterId !== spawn.shooterId || t.missile.weapon !== spawn.weapon)

    for (const missile of spawnProjectiles(spawn))
      this.tracked.push({ missile, grace: Infinity })
  }

  /** Spawn locally, before the server has said anything. */
  predict (spawn: ProjectileSpawn): void {
    for (const missile of spawnProjectiles(spawn))
      this.tracked.push({ missile, grace: OPTIMISTIC_TTL })
  }

  /** The server says this one is finished — impact, splash or burnt fuse. */
  detonate (id: number): void {
    const index = this.tracked.findIndex(t => t.missile.id === id)
    if (index >= 0)
      this.tracked.splice(index, 1)
  }

  /**
   * Advance every projectile.
   *
   * Homing goes through the same `homeToward` the server runs, so a client that
   * is drawing a missile and a server that is deciding whether it hit agree
   * about where it went.
   */
  step (dt: number, poseOf: PoseSource): void {
    for (let i = this.tracked.length - 1; i >= 0; i--) {
      const entry       = this.tracked[i]
      const { missile } = entry

      if (entry.grace !== Infinity) {
        entry.grace -= dt
        if (entry.grace <= 0) {
          this.tracked.splice(i, 1)
          continue
        }
      }

      const target = missile.targetId ? poseOf(missile.targetId) : null
      if (target)
        homeToward(missile, target, WEAPONS[missile.weapon], dt)

      if (!advanceProjectile(missile, dt))
        this.tracked.splice(i, 1)
    }
  }

  at (index: number): Missile | undefined {
    return this.tracked[index]?.missile
  }

  get count (): number {
    return this.tracked.length
  }

  clear (): void {
    this.tracked = []
  }
}
