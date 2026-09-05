/**
 * Spawn point choice, and the position half of respawn bookkeeping.
 *
 * `respawnIndex` picks a LANE, not a seat, and one formula serves both call
 * sites that used to duplicate it: `buildShell` hands out lane 0..N-1 as
 * players join so a stacked team does not spawn inside itself, and a kill
 * walks the same index forward every death so nobody respawns on the tile
 * they just died on.
 */

import type { ArenaTransform, BattleArena, BattleTeam } from './arena'


/** The spawn lane `index` selects for `team`, wrapping around the lane list. */
export function spawnAt (arena: BattleArena, team: BattleTeam, index: number): ArenaTransform {
  const lane = arena.spawns[team]
  return lane[index % lane.length]
}

/**
 * Where a kill drops the target: `spawnAt`'s position, lifted clear of the
 * deck by `lift`.
 *
 * Orientation is deliberately left alone here — a kill teleports the hull by
 * position only; `stepHovercraft`'s own reset path (driven by `resetRequested`
 * and the `spawn` field) is what re-levels a ship that respawns by falling
 * through the world instead.
 */
type RespawnPositionReturnType = { x: number; y: number; z: number }

export function respawnPosition (
  arena:  BattleArena,
  team:   BattleTeam,
  index:  number,
  lift:   number
): RespawnPositionReturnType {
  const [ x, y, z ] = spawnAt(arena, team, index).position
  return { x, y: y + lift, z }
}
