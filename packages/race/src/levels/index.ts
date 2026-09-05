/**
 * Every track, by id.
 *
 * Memoised: a track is immutable once generated, the spline walks are not free,
 * and the server would otherwise rebuild one per room. The client gets the same
 * instance the physics is running against, which is the point — a track that
 * differs between the two halves is a ship driving on invisible road.
 */

import { flatsTrack } from './flats'
import { neonCanyonTrack } from './neon-canyon'
import { orbitalRingTrack } from './orbital-ring'
import { proceduralTrack } from './procedural'

import type { TrackBundle, TrackId } from './types'


const BUILDERS: Record<TrackId, () => TrackBundle> = {
  'flats':        flatsTrack,
  'neon-canyon':  neonCanyonTrack,
  'orbital-ring': orbitalRingTrack,
  'procedural':   proceduralTrack,
}

export const TRACK_IDS = Object.keys(BUILDERS) as TrackId[]

const cache = new Map<TrackId, TrackBundle>()

export function trackBundle (id: TrackId): TrackBundle {
  let bundle = cache.get(id)
  if (!bundle) {
    bundle = BUILDERS[id]()
    cache.set(id, bundle)
  }
  return bundle
}

export function isTrackId (value: unknown): value is TrackId {
  return typeof value === 'string' && value in BUILDERS
}

export { flatsTrack, neonCanyonTrack, orbitalRingTrack, proceduralTrack }
export { FLATS_HALF, FLATS_WALLS } from './flats'
export type { TrackBundle, TrackId } from './types'
