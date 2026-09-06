import * as THREE from 'three'


/**
 * What a hull IS, measured rather than declared.
 *
 * Nine ships reach the game through three different pipelines — a glTF scene, a
 * clone of a WipEout FBX scan, and a mesh rebuilt from an extracted part table.
 * None of them carries an author's word for where its wings end, how deep its
 * keel runs or which slice of tail is engine pod, and hand-writing nine tables
 * of those numbers would rot the first time a model was re-exported.
 *
 * So every landmark below is DERIVED from the vertex cloud, in a frame where
 * the nose already points +z (the loader has applied `modelRotation` by then).
 * That is the whole reason the deformer can be one function for nine hulls:
 * the parameters are expressed against these landmarks, not against absolute
 * world units that only mean something on the ship they were tuned for.
 *
 * Nothing here touches a canvas or a GL context, so it runs in node.
 */

/** Cross-section stations sampled nose→tail. Enough to find a chine, cheap to walk. */
export const SLICE_COUNT = 24

/**
 * Quantile of |x| taken as the hull's half-beam.
 *
 * Not the max: a single antenna, mirror or wingtip light would set the beam for
 * the whole ship and push `wingThreshold` out past every real wing vertex,
 * which reads at runtime as "the wing sliders do nothing".
 */
const BEAM_QUANTILE = 0.98

/** Fraction of the half-beam past which a vertex starts counting as wing. */
const WING_INNER = 0.42

export type HullProfile = {

  /** Bounds in the hull frame: nose at +z, tail at −z, y up. */
  min:    THREE.Vector3;
  max:    THREE.Vector3;
  size:   THREE.Vector3;
  centre: THREE.Vector3;

  /** Robust half-width, from the |x| quantile rather than the outlier. */
  halfBeam: number;

  /** Half of the nose→tail span; the deformer's z normaliser. */
  halfLength: number;

  /** |x| at which the wing blend starts. Between here and `halfBeam` it ramps in. */
  wingThreshold: number;

  /** y above which a vertex reads as canopy/spine rather than fuselage. */
  canopyFloor: number;

  /** Normalised z (−1 tail … +1 nose) of the widest station — the chine line. */
  chineStation: number;

  /** Normalised z below which a vertex reads as engine bay. */
  podStation: number;

  /** Half-width per station, nose→tail. Index 0 is the nose. */
  halfWidths: Float32Array;

  /** Half-height per station, nose→tail. */
  halfHeights: Float32Array;

  /** Total vertices measured. Zero means the scan found no geometry. */
  vertexCount: number;
}

/** Every mesh in a hull, with the matrices that move it in and out of the hull frame. */
export type HullPart = {
  mesh: THREE.Mesh;

  /** Untouched source positions. The deformer always starts from these, never from the last result. */
  base: Float32Array;

  /**
   * Untouched source normals, when the asset shipped any.
   *
   * Kept so a hull returned to factory parameters gets its AUTHORED normals
   * back rather than a `computeVertexNormals()` approximation of them — the
   * two differ visibly on the FBX scans, whose hard edges are authored as
   * split normals that averaging rounds off.
   */
  baseNormal: Float32Array | null;

  /** Mesh local → hull frame. */
  toHull: THREE.Matrix4;

  /** Hull frame → mesh local. */
  fromHull: THREE.Matrix4;
}

export type HullRig = {
  profile: HullProfile;
  parts:   HullPart[];
}

const clamp01 = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v

/** Hermite ramp between two edges. Handles a reversed pair (b < a) as a falling ramp. */
export function smoothRamp (a: number, b: number, x: number): number {
  if (a === b)
    return x < a ? 0 : 1

  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

/**
 * Collect every mesh under `root`, snapshot its positions, and record the pair
 * of matrices that carry a vertex into `frame` and back.
 *
 * The snapshot is the reason a slider can be dragged back to 1.00 and land on
 * the original silhouette: deforming in place would compound every move.
 */
export function collectHullParts (root: THREE.Object3D, frame: THREE.Object3D): HullPart[] {
  root.updateWorldMatrix(true, true)
  frame.updateWorldMatrix(true, false)

  const inverse       = new THREE.Matrix4().copy(frame.matrixWorld)
    .invert()
  const parts: HullPart[] = []

  root.traverse(child => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh)
      return

    const position = mesh.geometry?.getAttribute('position')
    if (!position)
      return

    const normal     = mesh.geometry.getAttribute('normal')
    const baseNormal = normal ? Float32Array.from(normal.array as ArrayLike<number>) : null
    const toHull     = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld)
    parts.push({
      mesh,
      base:     Float32Array.from(position.array as ArrayLike<number>),
      baseNormal,
      toHull,
      fromHull: new THREE.Matrix4().copy(toHull)
        .invert(),
    })
  })

  return parts
}

/**
 * Measure a hull.
 *
 * One pass builds the bounds, a second fills the station profile — two passes
 * because the station index of a vertex is not known until the z extent is.
 * Both walk the SNAPSHOT, so re-measuring a deformed hull is impossible by
 * construction and the landmarks stay stable while sliders move.
 */
export function extractHullProfile (parts: HullPart[]): HullProfile {
  const min            = new THREE.Vector3(Infinity, Infinity, Infinity)
  const max            = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  const vertex         = new THREE.Vector3()
  const absX: number[] = []

  for (const part of parts)
    for (let i = 0; i < part.base.length; i += 3) {
      vertex.set(part.base[i], part.base[i + 1], part.base[i + 2]).applyMatrix4(part.toHull)
      min.min(vertex)
      max.max(vertex)
      absX.push(Math.abs(vertex.x))
    }

  if (!absX.length)
    return emptyProfile()

  const size   = new THREE.Vector3().subVectors(max, min)
  const centre = new THREE.Vector3().addVectors(min, max)
    .multiplyScalar(0.5)

  absX.sort((a, b) => a - b)

  const halfBeam = Math.max(absX[Math.min(absX.length - 1, Math.floor(absX.length * BEAM_QUANTILE))], 1e-4)

  const halfWidths  = new Float32Array(SLICE_COUNT)
  const halfHeights = new Float32Array(SLICE_COUNT)
  const zSpan       = Math.max(size.z, 1e-6)

  for (const part of parts)
    for (let i = 0; i < part.base.length; i += 3) {
      vertex.set(part.base[i], part.base[i + 1], part.base[i + 2]).applyMatrix4(part.toHull)

      // Station 0 is the NOSE, so the axis runs from max z down to min z.
      const slice        = Math.min(SLICE_COUNT - 1, Math.floor((max.z - vertex.z) / zSpan * SLICE_COUNT))
      halfWidths[slice]  = Math.max(halfWidths[slice], Math.abs(vertex.x))
      halfHeights[slice] = Math.max(halfHeights[slice], Math.abs(vertex.y - centre.y))
    }

  let widest = 0
  for (let i = 1; i < SLICE_COUNT; i++)
    if (halfWidths[i] > halfWidths[widest])
      widest = i

  // Station index → normalised z, matching the deformer's −1 tail … +1 nose axis.
  const chineStation = 1 - 2 * ((widest + 0.5) / SLICE_COUNT)

  return {
    min,
    max,
    size,
    centre,
    halfBeam,
    halfLength:    Math.max(size.z * 0.5, 1e-4),
    wingThreshold: halfBeam * WING_INNER,

    // Two thirds up the hull: above this a vertex belongs to the canopy bulge
    // rather than the body, on hulls whose canopy is a smooth continuation of
    // the deck and has no seam to find.
    canopyFloor: min.y + size.y * 0.66,
    chineStation,

    // The rear fifth. Every hull here puts its thrusters there, and a slab is
    // the one engine landmark that survives a scan with no material names.
    podStation:  -0.6,
    halfWidths,
    halfHeights,
    vertexCount: absX.length,
  }
}

function emptyProfile (): HullProfile {
  return {
    min:           new THREE.Vector3(),
    max:           new THREE.Vector3(),
    size:          new THREE.Vector3(),
    centre:        new THREE.Vector3(),
    halfBeam:      1,
    halfLength:    1,
    wingThreshold: WING_INNER,
    canopyFloor:   0,
    chineStation:  0,
    podStation:    -0.6,
    halfWidths:    new Float32Array(SLICE_COUNT),
    halfHeights:   new Float32Array(SLICE_COUNT),
    vertexCount:   0,
  }
}

/**
 * Build the rig the deformer runs against: every mesh snapshotted, every
 * landmark measured, in one call so the two can never disagree about which
 * frame they are in.
 */
export function buildHullRig (root: THREE.Object3D, frame: THREE.Object3D): HullRig {
  const parts = collectHullParts(root, frame)
  return { parts, profile: extractHullProfile(parts) }
}

/** Half-width at a normalised station, linearly blended between the two nearest. */
export function halfWidthAt (profile: HullProfile, station: number): number {
  return sampleStations(profile.halfWidths, station)
}

/** Half-height at a normalised station. */
export function halfHeightAt (profile: HullProfile, station: number): number {
  return sampleStations(profile.halfHeights, station)
}

function sampleStations (table: Float32Array, station: number): number {
  const t     = clamp01((1 - station) * 0.5) * (SLICE_COUNT - 1)
  const lower = Math.floor(t)
  const upper = Math.min(SLICE_COUNT - 1, lower + 1)
  return table[lower] + (table[upper] - table[lower]) * (t - lower)
}
