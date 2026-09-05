/**
 * How a track is drawn.
 *
 * `LevelSpec` is gone. It carried waypoints, laps, colliders AND a three.js
 * `build()` closure in one object, which was fine while race ran only in a
 * browser and impossible once the server needed the first half without the
 * second. The data lives in `@crash-velocity/race` now; this is the other half.
 */

import { buildFlats } from './flats'
import { buildNeonCanyon } from './neon-canyon'
import { buildOrbitalRing } from './orbital-ring'
import { buildProcedural } from './procedural'

import type { SceneContext } from 'threejs-scene'
import type { TrackBundle, TrackId } from '@crash-velocity/race'


export type TrackVisual = (ctx: SceneContext, bundle: TrackBundle) => void

export const TRACK_VISUALS: Record<TrackId, TrackVisual> = {
  'flats':        buildFlats,
  'neon-canyon':  buildNeonCanyon,
  'orbital-ring': buildOrbitalRing,
  'procedural':   buildProcedural,
}

export type { TrackId }
