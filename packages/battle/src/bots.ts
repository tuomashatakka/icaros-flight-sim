/**
 * Bot backfill.
 *
 * A one-human match should still be a match: the arena has five control points
 * and two flags, and none of those rules get exercised by an empty deck. The
 * sim already ships the AI (`Δengine/battle/bot`) and already drives any player
 * flagged `isBot`, so backfill is purely a population policy — how many, on
 * which team, and who gets evicted when a human takes the seat.
 */

import { BATTLE_TEAMS } from './arena'
import type { BattleTeam } from './arena'
import type { BattleSim } from './sim'


export type BackfillConfig = {

  /** Total ships the room aims to keep on the deck, humans included. */
  minPlayers: number;

  enabled: boolean;
}

export const DEFAULT_BACKFILL: BackfillConfig = { minPlayers: 6, enabled: true }

function countBy (sim: BattleSim, team: BattleTeam, bots: boolean): number {
  return sim.players.filter(p => p.team === team && p.isBot === bots).length
}

/** The team a joining human should take: the one with fewer humans, red on a tie. */
export function teamForJoin (sim: BattleSim): BattleTeam {
  const [ red, blue ] = BATTLE_TEAMS
  return countBy(sim, blue, false) < countBy(sim, red, false) ? blue : red
}

/**
 * Bring the bot population back in line after any roster change.
 *
 * Called on join and on leave rather than every tick: it allocates rapier
 * bodies, and doing that 60 times a second to discover nothing changed would be
 * the room's most expensive no-op.
 */
export function rebalanceBots (sim: BattleSim, config: BackfillConfig = DEFAULT_BACKFILL): void {
  if (!config.enabled) {
    for (const bot of sim.players.filter(p => p.isBot))
      sim.removePlayer(bot.id)
    return
  }

  const target = Math.max(0, config.minPlayers - sim.players.filter(p => !p.isBot).length)

  // Drop surplus bots before adding any, so a room shrinking and growing in the
  // same breath does not churn bodies it is about to remove.
  while (sim.players.filter(p => p.isBot).length > target) {
    const fullest = [ ...BATTLE_TEAMS ].sort((a, b) => teamSize(sim, b) - teamSize(sim, a))
    const victim  = sim.players.find(p => p.isBot && p.team === fullest[0]) ??
      sim.players.find(p => p.isBot)
    if (!victim)
      break
    sim.removePlayer(victim.id)
  }

  while (sim.players.filter(p => p.isBot).length < target) {
    const [ red, blue ] = BATTLE_TEAMS
    sim.addBot(teamSize(sim, blue) < teamSize(sim, red) ? blue : red)
  }
}

function teamSize (sim: BattleSim, team: BattleTeam): number {
  return sim.players.filter(p => p.team === team).length
}
