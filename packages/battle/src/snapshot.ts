/**
 * Reading a battle tick into the bit-packed wire shape.
 *
 * The baseline bookkeeping that goes with it is NOT here — it is mode-agnostic
 * and lives in `@crash-velocity/net`'s `seats`, because a client that
 * acknowledges snapshots out of order behaves the same whether it is racing or
 * fighting.
 */

import { ShipFlags, buildSnapshot } from 'Ξ'

import type { ShipState, Snapshot } from 'Ξ'
import type { BattleSim } from './sim'


/** Read the authoritative ships into the wire shape, velocities included. */
export function battleSnapshotOf (sim: BattleSim, tick: number, netIndexOf: (id: string) => number): Snapshot {
  const ships: ShipState[] = []

  for (const player of sim.players) {
    const t = player.chassis.translation()
    const r = player.chassis.rotation()
    const v = player.chassis.linvel()
    const w = player.chassis.angvel()

    let flags = 0
    if (player.health > 0)
      flags |= ShipFlags.ALIVE
    if (player.controls.boost)
      flags |= ShipFlags.BOOSTING
    if (player.stun > 0)
      flags |= ShipFlags.RESPAWNING
    if (player.controls.brake)
      flags |= ShipFlags.BRAKING
    if (player.controls.fire)
      flags |= ShipFlags.FIRING

    ships.push({
      id:           netIndexOf(player.id),
      x:            t.x,
      y:            t.y,
      z:            t.z,
      qx:           r.x,
      qy:           r.y,
      qz:           r.z,
      qw:           r.w,
      vx:           v.x,
      vy:           v.y,
      vz:           v.z,
      wx:           w.x,
      wy:           w.y,
      wz:           w.z,
      health:       Math.max(0, Math.min(255, Math.round(player.health))),
      flags,
      respawnIndex: player.respawnIndex & 0xff,
      // Normalised so the codec's ±1 range covers the trim regardless of AIM_MAX.
      aim:          Math.max(-1, Math.min(1, player.aimAngle / AIM_NORMALISER)),
    })
  }

  return buildSnapshot(tick, ships)
}

/** Radians of trim the ±1 wire range maps onto. Mirrors `AIM_MAX` in the sim. */
export const AIM_NORMALISER = Math.PI / 4
