/**
 * A track, and the geometry a renderer would want with it.
 *
 * The two halves travel together on purpose. Splitting them into "data over
 * here, spline over there" would mean evaluating the same Catmull-Rom twice and
 * hoping the two agreed — and they would not, the first time someone nudged a
 * control point. So the generator runs once and hands back both; the server
 * reads `spec` and drops the rest on the floor, which costs one BufferGeometry
 * per track per process.
 */

import type * as THREE from 'three'
import type { TrackSpec } from '../track'


export type TrackBundle = {
  spec: TrackSpec;

  /** Ribbon mesh, for tracks generated from a spline or a walk. */
  geometry?: THREE.BufferGeometry;

  /**
   * The ribbon's edge strip, `[Lx,Ly,Lz, Rx,Ry,Rz, …]`.
   *
   * Carried for the same reason as `geometry`: the barriers are generated from
   * it on both sides of the split, so the wall you hit and the wall you see are
   * the same wall. Deriving it again from the curve on the render side is what
   * would let them disagree.
   */
  vertices?: Float32Array;

  /** The sampled centreline, for rails and scenery placement. */
  curve?: THREE.CatmullRomCurve3;
}

export type TrackId = 'flats' | 'neon-canyon' | 'orbital-ring' | 'procedural'
