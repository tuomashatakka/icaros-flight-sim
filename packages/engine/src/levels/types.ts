/**
 * How a track is drawn.
 *
 * `LevelSpec` is gone. It carried waypoints, laps, colliders AND a three.js
 * `build()` closure in one object, which was fine while race ran only in a
 * browser and impossible once the server needed the first half without the
 * second. The data lives in `@crash-velocity/race` now; this is the other half.
 *
 * A track's environment belongs on this side too: sky colour, fog range and
 * fill tint are things you look at, and the server draws nothing.
 */

import { buildFlats, flatsEnvironment } from './flats'
import { buildNeonCanyon, neonCanyonEnvironment } from './neon-canyon'
import { buildOrbitalRing, orbitalRingEnvironment } from './orbital-ring'
import { buildProcedural, proceduralEnvironment } from './procedural'

import type { SceneContext } from 'threejs-scene'
import type { TrackBundle, TrackId } from 'Λ'
import type { EnvironmentOverrides } from '../environment'


/**
 * Everything the renderer needs for one track.
 *
 * One record rather than two keyed by `TrackId`, so a track's identity cannot
 * half-exist: adding a track without its environment is a type error at the
 * table below rather than a level that silently inherits someone else's sky.
 */
export type TrackVisual = {
  environment: EnvironmentOverrides;
  build:       (ctx: SceneContext, bundle: TrackBundle) => void;
}

export const TRACK_VISUALS: Record<TrackId, TrackVisual> = {
  'flats':        { environment: flatsEnvironment, build: buildFlats },
  'neon-canyon':  { environment: neonCanyonEnvironment, build: buildNeonCanyon },
  'orbital-ring': { environment: orbitalRingEnvironment, build: buildOrbitalRing },
  'procedural':   { environment: proceduralEnvironment, build: buildProcedural },
}

export type { TrackId }
