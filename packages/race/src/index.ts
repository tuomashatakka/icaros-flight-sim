/**
 * Race's public surface.
 *
 * `./room` is deliberately NOT re-exported: it imports `@colyseus/core`, a
 * server-only dependency, and this barrel is imported by the browser for the
 * sim types, the rules and the track data. Reach the room as
 * `@crash-velocity/race/room`.
 */

export { AIM_MAX, AIM_RATE, RaceSim } from './sim'
export type { Racer } from './sim'

export * from './types'

export {
  COUNTDOWN_SECONDS, createProgress, formatTime, passCheckpoint,
  respawnAt, standings, tickProgress,
} from './rules'
export type { GateResult, RaceProgress, RaceRules, RaceStatus } from './rules'

export { buildCheckpoints, crossedGate } from './track'
export type { Checkpoint, TrackSpec, Vec3Tuple } from './track'

export { boxColliderFromRing, buildTrack, ribbonBoxColliders } from './track-geometry'
export type { TrackConfig, TrackGeometry } from './track-geometry'

export { FLATS_HALF, FLATS_WALLS, TRACK_IDS, isTrackId, trackBundle } from './levels'
export type { TrackBundle, TrackId } from './levels'

export { RaceState, RacerState, syncRaceState } from './state'
export type { RaceStateType, RacerStateType } from './state'

export { raceSnapshotOf } from './snapshot'
export { raceBotInput } from './bot'
