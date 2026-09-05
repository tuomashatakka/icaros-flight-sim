/**
 * Control-zone capture rules, as pure functions over a zone record and the
 * players standing near it.
 *
 * Extracted from `BattleSim.stepZones`, which carried a complexity of 24 once
 * the sticky-hold, contest-drain and stacking-bonus rules were all layered
 * into one method. Scoring is deliberately NOT here — see `scoring.ts`'s
 * `tickZoneScore` — because the original method only ever ticked a zone's
 * score meter when the zone STARTED the tick already owned: a zone that flips
 * to owned mid-tick (via the `continue` below) scores nothing until the next
 * one. Splitting the concerns without losing that one-tick lag means the
 * caller decides whether to call the scoring half at all; see `sim.ts`'s
 * `stepZones`.
 */

import type { BattleTeam, ControlPointDef } from './arena'
import type { BattleEvent, BattleZone } from './types'


/** A player, reduced to what the capture circle test needs. */
export type ZonePose = { team: BattleTeam; x: number; z: number }

/** How many of each team stand inside a zone's capture circle right now. */
export function countOccupants (def: ControlPointDef, poses: readonly ZonePose[]): Record<BattleTeam, number> {
  const counts: Record<BattleTeam, number> = { red: 0, blue: 0 }
  const [ x, , z ]                         = def.position
  const r2                                 = def.radius * def.radius

  for (const p of poses) {
    const dx = p.x - x
    const dz = p.z - z
    if (dx * dx + dz * dz <= r2)
      counts[p.team]++
  }

  return counts
}

export type ZoneTimings = { captureTime: number; contestDrain: number }

/** Fill an unowned zone toward `dominant`, or bleed back an abandoned part-capture. */
function growUnownedZone (
  zone:        BattleZone,
  dt:          number,
  dominant:    BattleTeam | null,
  occupied:    boolean,
  rate:        number,
  captureTime: number
): BattleEvent | null {
  if (dominant) {
    if (zone.capturing !== dominant) {
      zone.capturing = dominant
      zone.progress  = 0
    }
    zone.progress += dt / captureTime * rate
    if (zone.progress >= 1) {
      zone.owner     = dominant
      zone.progress  = 1
      zone.capturing = null
      return { type: 'zoneChange', id: zone.def.id, owner: dominant }
    }
    return null
  }

  if (!occupied && zone.progress > 0) {
    zone.progress = Math.max(0, zone.progress - dt / (captureTime * 3))
    if (zone.progress === 0)
      zone.capturing = null
  }
  return null
}

/** Hold, drain or refill an owned zone's meter against whoever is inside it. */
function contestOwnedZone (
  zone:         BattleZone,
  dt:           number,
  counts:       Record<BattleTeam, number>,
  dominant:     BattleTeam | null,
  rate:         number,
  contestDrain: number
): BattleEvent | null {
  const owner = zone.owner as BattleTeam
  const enemy = owner === 'red' ? 'blue' : 'red'

  if (counts[enemy] === 0) {
    // Sticky: held, unattended, and going nowhere.
    zone.progress  = 1
    zone.capturing = null
    zone.contested = false
    return null
  }

  if (dominant === enemy) {
    zone.capturing = enemy
    zone.progress -= dt / contestDrain * rate
    if (zone.progress <= 0) {
      zone.owner    = null
      zone.progress = 0
      return { type: 'zoneChange', id: zone.def.id, owner: null }
    }
    return null
  }

  if (dominant === owner)
    zone.progress = Math.min(1, zone.progress + dt / contestDrain * rate)
  // A dead tie freezes the meter: neither side is winning the point.

  return null
}

/**
 * Advance one zone's ownership and capture meter by one tick.
 *
 * Mutates `zone` in place — `owner`, `progress`, `capturing`, `contested` —
 * and returns the `zoneChange` event on the tick ownership actually flips, or
 * null otherwise. Domination rules, preserved from the original method:
 *
 *   · a point fills only for the team that outnumbers the other inside the
 *     circle, faster the bigger the lead (capped at 2.5x)
 *   · once full it is STICKY: with no enemy inside, nothing decays
 *   · an intruder must drain the holder's meter to zero (neutralising the
 *     point) before their own capture can start
 *   · an abandoned part-capture bleeds back slowly rather than resetting
 */
export function stepZone (
  zone:    BattleZone,
  dt:      number,
  counts:  Record<BattleTeam, number>,
  timings: ZoneTimings
): BattleEvent | null {
  const { captureTime, contestDrain } = timings

  const lead                        = counts.red - counts.blue
  const dominant: BattleTeam | null = lead > 0 ? 'red' : lead < 0 ? 'blue' : null
  const margin                      = Math.abs(lead)
  const rate                        = dominant ? Math.min(2.5, 1 + (margin - 1) * 0.45) : 0
  const occupied                    = counts.red + counts.blue > 0

  zone.contested = counts.red > 0 && counts.blue > 0

  return zone.owner === null
    ? growUnownedZone(zone, dt, dominant, occupied, rate, captureTime)
    : contestOwnedZone(zone, dt, counts, dominant, rate, contestDrain)
}
