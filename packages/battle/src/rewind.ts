/**
 * Battle's binding of the shared rewind buffer.
 *
 * The buffer itself is mode-agnostic and lives in `@crash-velocity/net`; all
 * that is battle-specific is knowing that a `BattlePlayer` keeps its position
 * on a rapier body. Passing that as an accessor rather than making the buffer
 * call a method keeps recording allocation-free — this runs sixty times a
 * second for the life of every match.
 */

import { RewindBuffer } from 'Ξ'

import type { Vec3 } from 'Ξ'
import type { BattlePlayer } from './sim'


export const battlePose = (player: BattlePlayer): Vec3 => player.chassis.translation()

export function createBattleRewind (tickHz: number): RewindBuffer<BattlePlayer> {
  return new RewindBuffer<BattlePlayer>(tickHz, battlePose)
}
