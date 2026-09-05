/**
 * Battle's public surface.
 *
 * `./room` is deliberately NOT re-exported: it imports `@colyseus/core`, which
 * is a server-only dependency, and this barrel is imported by the browser for
 * the sim types and the shared projectile maths. Reach the room as
 * `@crash-velocity/battle/room`.
 */

export { BattleSim, DEFAULT_BATTLE_CONFIG, NEUTRAL_INPUT } from './sim'
export type { BattleConfig, BattlePlayer } from './sim'

export * from './types'

export { BATTLE_TEAMS, NEUTRAL_COLOR, TEAM_COLORS, apexArena, onPlateau, plateauColliders, rampApproach, rampFeet, otherTeam } from './arena'
export type { ArenaTransform, BattleArena, BattleTeam, ControlPointDef, PlateauDef } from './arena'

export { WEAPONS } from './weapons'
export type { Loadout, LockPhase, LockState, WeaponId, WeaponSpec } from './weapons'

export { resolveBeamHits, resolveBlastHits } from './hitscan'
export type { HitCandidate } from './hitscan'

export { advanceProjectile, homeToward, spawnProjectiles } from './projectiles'
export type { ProjectileSpawn } from './projectiles'

export { BattleState, FlagState, PlayerState, ZoneState, syncBattleState } from './state'
export type { BattleStateType, PlayerStateType } from './state'

export { AIM_NORMALISER, battleSnapshotOf } from './snapshot'

export { battlePose, createBattleRewind } from './rewind'
export { botInput } from './bot'
export { DEFAULT_BACKFILL, rebalanceBots, teamForJoin } from './bots'
