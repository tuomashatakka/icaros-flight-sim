import * as THREE from 'three'

import { HULL_DEFAULTS, isFactoryShape } from 'Ȼship/hull-shape'
import type { HullShape } from 'Ȼship/hull-shape'

import { halfHeightAt, smoothRamp } from './hull-profile'
import type { HullProfile, HullRig } from './hull-profile'


/**
 * The deformer behind `Ȼship/hull-shape`.
 *
 * The fifteen parameters are declared in `core`, because `Ƨ` persists them and
 * `Ʊ` renders them and neither may import three.js. This module is the half
 * that owns vertices: it reads the landmarks `extractHullProfile` measured and
 * moves the cloud, which is what makes ONE function enough for nine hulls that
 * share no author, no scale and no pipeline.
 *
 * At `HULL_DEFAULTS` it restores the snapshot verbatim — positions and the
 * authored normals both — so "reset silhouette" gives back the source mesh
 * rather than a `computeVertexNormals()` approximation of it.
 */

export type { HullShape }
export { HULL_DEFAULTS }

const DEG     = Math.PI / 180
const clamp01 = (v: number) => v < 0 ? 0 : v > 1 ? 1 : v

/**
 * Per-vertex masks, all in [0, 1].
 *
 * Computed from the SNAPSHOT position, never from the running one: a mask that
 * moved with the vertex it weights would feed back on itself and the same
 * slider value would land somewhere different depending on the order the
 * sliders were touched.
 */
type Masks = {
  front:  number;
  rear:   number;
  wing:   number;
  pod:    number;
  canopy: number;
  keel:   number;
  chine:  number;
  spine:  number;
}

function maskAt (profile: HullProfile, x: number, y: number, station: number): Masks {
  const { halfBeam, wingThreshold, canopyFloor, chineStation, podStation, min, max, size, centre } = profile

  const absX = Math.abs(x)
  const yf   = clamp01((y - min.y) / Math.max(size.y, 1e-6))

  // A wing is BOTH outboard and thin. Width alone would grab the engine pods,
  // which sit as far outboard as the tips on half the fleet; the thinness term
  // is what tells a lifting surface from a nacelle. It never falls to zero, so
  // a hull with no discernible wing still answers the wing sliders as a flare.
  const thin = Math.abs(y - centre.y) / Math.max(halfHeightAt(profile, station), 1e-6)
  const flat = 0.35 + 0.65 * smoothRamp(0.85, 0.25, thin)
  const wing = smoothRamp(wingThreshold, halfBeam, absX) * flat

  return {
    front:  clamp01(station),
    rear:   clamp01(-station),
    wing,
    pod:    clamp01((podStation - station) / (podStation + 1)),
    canopy: smoothRamp(canopyFloor, max.y, y) * smoothRamp(0.85, 0.1, Math.abs(station - 0.1)),
    keel:   smoothRamp(0.35, 0, yf),
    chine:  smoothRamp(0.3, 1, absX / halfBeam) * smoothRamp(0.8, 0, Math.abs(station - chineStation)),
    spine:  yf,
  }
}

const _v = new THREE.Vector3()

/** Everything the per-vertex step needs that does not change between vertices. */
type Rig = {
  profile:  HullProfile;
  shape:    HullShape;
  halfY:    number;
  sweep:    number;
  dihedral: number;
  twist:    number;
}

/**
 * Move one vertex, in the hull frame, writing the result back into `_v`.
 *
 * Split out of the loop so each stage of the build-up reads as one line and the
 * order stays visible: proportions, planform, ends, engine bay, section, twist.
 */
function deformVertex (rig: Rig, out: THREE.Vector3): void {
  const { profile, shape, halfY, sweep, dihedral, twist } = rig
  const { centre, min, size, halfBeam, halfLength }       = profile

  const station = (out.z - centre.z) / halfLength
  const masks   = maskAt(profile, out.x, out.y, station)

  // Gross proportions. Height anchors on the keel; the other two on the centre.
  let dx = (out.x - centre.x) * shape.bodyWidth
  let dy = (out.y - min.y) * shape.bodyHeight - halfY
  let dz = (out.z - centre.z) * shape.bodyLength

  // Plan view: span, then rake, then dihedral — a swept tip has to be moved
  // outboard before the sweep can decide how far aft it lands.
  dx += Math.sign(dx) * (shape.wingSpan - 1) * masks.wing * halfBeam * 0.9
  dz -= masks.wing * Math.abs(dx) * sweep * 0.5
  dy += masks.wing * Math.abs(dx) * dihedral

  // Nose and tail.
  dz += (shape.noseSharp - 1) * masks.front * halfLength * 0.35
  dx *= 1 - (shape.noseSharp - 1) * masks.front * 0.35
  dx *= 1 - (shape.tailTaper - 1) * masks.rear * 0.55
  dy *= 1 - (shape.tailTaper - 1) * masks.rear * 0.35

  // Engine bay.
  dx *= 1 + (shape.podRadius - 1) * masks.pod
  dy *= 1 + (shape.podRadius - 1) * masks.pod * 0.7
  dz -= (shape.podLength - 1) * masks.pod * halfLength * 0.35

  // Section: canopy up, keel down, spine bowed, chine flared out.
  dy += (shape.canopyRise - 1) * masks.canopy * size.y * 0.5
  dy -= (shape.keelDepth - 1) * masks.keel * size.y * 0.4
  dy += shape.spineArch * Math.cos(station * Math.PI * 0.5) * masks.spine * size.y * 0.3
  dx += Math.sign(dx) * shape.chineFlare * masks.chine * halfBeam * 0.4

  // Twist last: it rotates whatever the earlier steps built, which is what
  // makes it read as a hull that was wrung rather than a hull drawn skewed.
  if (twist !== 0) {
    const angle = twist * station
    const cos   = Math.cos(angle)
    const sin   = Math.sin(angle)
    const rx    = dx * cos - dy * sin
    dy = dx * sin + dy * cos
    dx = rx
  }

  out.set(centre.x + dx, centre.y + dy, centre.z + dz)
}

/**
 * Reshape every mesh in the rig.
 *
 * Walks the snapshot, applies the fifteen parameters in hull space, and writes
 * the result back through each part's own inverse matrix — so a child mesh
 * parented at an offset (the generated Icaras carries four of them) deforms
 * with the hull instead of sliding out of it, and nothing has to counter-scale.
 *
 * Costs one pass over the vertex cloud plus a normal rebuild, so callers gate
 * it on `hullShapeKey` rather than calling it per frame.
 */
export function applyHullDeform (hull: HullRig, shape: HullShape): void {
  const { profile, parts } = hull

  if (isFactoryShape(shape)) {
    restoreHull(parts)
    return
  }

  const rig: Rig = {
    profile,
    shape,
    halfY:    Math.max(profile.size.y * 0.5, 1e-6),
    sweep:    Math.tan(shape.wingSweep * DEG),
    dihedral: Math.sin(shape.wingDihedral * DEG),
    twist:    shape.hullTwist * DEG,
  }

  for (const part of parts) {
    const attribute = part.mesh.geometry.getAttribute('position') as THREE.BufferAttribute
    const out       = attribute.array as Float32Array

    for (let i = 0; i < part.base.length; i += 3) {
      _v.set(part.base[i], part.base[i + 1], part.base[i + 2]).applyMatrix4(part.toHull)
      deformVertex(rig, _v)
      _v.applyMatrix4(part.fromHull)
      out[i]     = _v.x
      out[i + 1] = _v.y
      out[i + 2] = _v.z
    }

    attribute.needsUpdate = true
    part.mesh.geometry.computeVertexNormals()
    part.mesh.geometry.computeBoundingSphere()
    part.mesh.geometry.computeBoundingBox()
  }
}

/** Put every mesh back to its snapshot, authored normals included. */
export function restoreHull (parts: HullRig['parts']): void {
  for (const part of parts) {
    const attribute = part.mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    (attribute.array as Float32Array).set(part.base)
    attribute.needsUpdate = true

    const normal = part.mesh.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined
    if (normal && part.baseNormal) {
      (normal.array as Float32Array).set(part.baseNormal)
      normal.needsUpdate = true
    }

    part.mesh.geometry.computeBoundingSphere()
    part.mesh.geometry.computeBoundingBox()
  }
}
