/**
 * Score deltas and the win check.
 *
 * Pulled out of `stepZones`, `integrateCarriedFlags` and `kill`, so the number
 * a team's score changes by for holding a point lives next to the number it
 * changes by for scoring a core, instead of buried inside three unrelated
 * pieces of the class.
 */

import type { BattleTeam } from './arena'
import type { BattleConfig, BattleZone } from './types'


/** True once either team has scored enough to end the match. */
export function scoreTargetReached (
  scores: Record<BattleTeam, number>,
  config: Pick<BattleConfig, 'scoreTarget'>
): boolean {
  return scores.red >= config.scoreTarget || scores.blue >= config.scoreTarget
}

/**
 * Tick a held zone's score meter.
 *
 * Only meaningful for a zone the caller has already established started this
 * tick owned — a zone that flips to owned mid-tick accrues nothing until the
 * next one; see `zones.ts`'s `stepZone`. Returns true the tick a score tick
 * pushes either team over `scoreTarget`, so the caller knows to end the match.
 */
export function tickZoneScore (
  zone:       BattleZone,
  dt:         number,
  zonePeriod: number,
  config:     Pick<BattleConfig, 'zoneScore' | 'scoreTarget'>,
  scores:     Record<BattleTeam, number>
): boolean {
  if (!(zone.owner && zone.progress >= 1)) {
    zone.scoreAccum = 0
    return false
  }

  zone.scoreAccum += dt

  let ended = false
  while (zone.scoreAccum >= zonePeriod) {
    zone.scoreAccum -= zonePeriod
    scores[zone.owner] += config.zoneScore
    if (scoreTargetReached(scores, config))
      ended = true
  }
  return ended
}

/** Credit a core capture to `team` and hand back its new total. */
export function scoreFlagCapture (
  scores: Record<BattleTeam, number>,
  team:   BattleTeam,
  bonus:  number
): number {
  scores[team] += bonus
  return scores[team]
}

/** A kill's tally: one more death for the target, one more kill for whoever caused it (never a suicide). */
type TargetType = { id: string; deaths: number }

export function registerKill (
  target: TargetType,
  killer: { id: string; kills: number } | undefined
): void {
  target.deaths++
  if (killer && killer.id !== target.id)
    killer.kills++
}
