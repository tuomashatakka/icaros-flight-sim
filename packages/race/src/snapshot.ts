/**
 * Reading a race tick into the bit-packed wire shape.
 *
 * The same `ShipState` record battle sends, deliberately: one codec, one
 * interpolator and one prediction loop cover both modes, and the fields race
 * does not use (health, aim) cost eight and twelve bits respectively — far less
 * than a second wire format would cost in bugs.
 */

import { ShipFlags } from 'Ξ'

import type { ShipState, Snapshot } from 'Ξ'
import type { RaceSim } from './sim'


export function raceSnapshotOf (sim: RaceSim, netIndexOf: (id: string) => number): Snapshot {
  const ships: ShipState[] = []

  for (const racer of sim.racers) {
    const t = racer.chassis.translation()
    const r = racer.chassis.rotation()
    const v = racer.chassis.linvel()
    const w = racer.chassis.angvel()

    let flags = ShipFlags.ALIVE
    if (racer.controls.boost)
      flags |= ShipFlags.BOOSTING
    if (racer.grounded)
      flags |= ShipFlags.GROUNDED
    if (racer.controls.brake)
      flags |= ShipFlags.BRAKING

    ships.push({
      id: netIndexOf(racer.id),
      x:  t.x,
      y:  t.y,
      z:  t.z,
      qx: r.x,
      qy: r.y,
      qz: r.z,
      qw: r.w,
      vx: v.x,
      vy: v.y,
      vz: v.z,
      wx: w.x,
      wy: w.y,
      wz: w.z,

      // Race has no damage, so health carries the BOOST meter instead — the one
      // per-ship scalar the HUD needs at snapshot rate. Documented rather than
      // renamed, because renaming it would fork the codec for one field.
      health:       Math.max(0, Math.min(255, Math.round(racer.boostMeter * 255))),
      flags,
      respawnIndex: racer.progress.respawnIndex & 0xff,
      aim:          Math.max(-1, Math.min(1, racer.aimAngle / (Math.PI / 4))),
    })
  }

  return { serverTick: sim.tick, serverTimeMs: Date.now(), baselineTick: 0, lastProcessedInput: 0, ships, removed: []}
}
