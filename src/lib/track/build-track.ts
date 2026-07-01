"use client";

import * as THREE from 'three';

export interface TrackConfig {
  /** Control points the centerline spline passes through. */
  points: THREE.Vector3[];
  /** Total road width in world units. */
  width: number;
  /** Samples taken per control-point span (higher = smoother). */
  segments: number;
  /** Close the spline into a loop. Auto-detected when first≈last point. */
  closed?: boolean;
  /** Max banking angle (radians) applied proportional to local curvature. 0 = flat. */
  banking?: number;
}

export interface TrackGeometry {
  geometry: THREE.BufferGeometry;
  vertices: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** The sampled centerline curve — handy for rails, lines and scenery placement. */
  curve: THREE.CatmullRomCurve3;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);

export interface BoxCollider {
  position: [number, number, number];
  rotation: [number, number, number];
  /** Half-extents [halfWidth, halfThickness, halfLength]. */
  args: [number, number, number];
}

/**
 * Builds one thin oriented box collider spanning two ribbon rings (L0,R0 and
 * L1,R1). Shared by `ribbonBoxColliders`'s sequential walk and by callers that
 * need to bridge two rings that aren't array-adjacent (e.g. a hand-stitched
 * branch/merge junction — see procedural.tsx).
 */
export function boxColliderFromRing(
  L0: THREE.Vector3,
  R0: THREE.Vector3,
  L1: THREE.Vector3,
  R1: THREE.Vector3,
  thickness = 0.5,
  maxLen = Infinity
): BoxCollider | null {
  const mid0 = L0.clone().add(R0).multiplyScalar(0.5);
  const mid1 = L1.clone().add(R1).multiplyScalar(0.5);
  const forwardVec = mid1.clone().sub(mid0);
  const len = forwardVec.length();
  if (len < 1e-3 || len > maxLen) return null;

  const forward = forwardVec.normalize();
  const sideVec = R0.clone().sub(L0);
  const halfWidth = sideVec.length() * 0.5;
  if (halfWidth < 1e-3) return null;
  const right = sideVec.normalize();
  const up = right.clone().cross(forward).normalize();

  const basis = new THREE.Matrix4().makeBasis(right, up, forward);
  const euler = new THREE.Euler().setFromRotationMatrix(basis);
  const center = mid0.clone().add(mid1).multiplyScalar(0.5);

  return {
    position: [center.x, center.y, center.z],
    rotation: [euler.x, euler.y, euler.z],
    args: [halfWidth, thickness, len * 0.5],
  };
}

/**
 * Walks a ribbon's [L0,R0,L1,R1,…] vertex strip and emits one thin oriented box
 * collider per segment. rapier's raycast-vehicle wheels collide with cuboids but
 * NOT trimeshes in this version, so the drivable surface is built from boxes.
 *
 * Segments longer than `maxLen` are skipped — this drops the spurious bridges
 * across branch/merge gaps in hand-authored strips (e.g. procedural.tsx).
 */
export function ribbonBoxColliders(
  vertices: Float32Array,
  opts: { thickness?: number; maxLen?: number; stride?: number } = {}
): BoxCollider[] {
  const thickness = opts.thickness ?? 0.5;
  const maxLen = opts.maxLen ?? 60;
  const stride = opts.stride ?? 2;

  const rings = Math.floor(vertices.length / 6); // L,R pair = 6 floats
  const at = (i: number) => new THREE.Vector3(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]);
  const boxes: BoxCollider[] = [];

  for (let i = 0; i + stride < rings; i += stride) {
    const L0 = at(i * 2), R0 = at(i * 2 + 1);
    const L1 = at((i + stride) * 2), R1 = at((i + stride) * 2 + 1);
    const box = boxColliderFromRing(L0, R0, L1, R1, thickness, maxLen);
    if (box) boxes.push(box);
  }

  return boxes;
}

/**
 * Sweeps a flat (optionally banked) road ribbon along a Catmull-Rom spline.
 *
 * Two vertices are emitted per sample — the left and right road edges, offset
 * from the centerline along a level "side" vector. Consecutive samples are
 * stitched into quads, giving a continuous drivable surface whose `position` +
 * `index` buffers double as the rapier trimesh collider.
 */
export function buildTrack(config: TrackConfig): TrackGeometry {
  const halfWidth = config.width / 2;
  const banking = config.banking ?? 0;

  // Drop a duplicated closing point and treat the path as a loop.
  const pts = config.points.map((p) => p.clone());
  let closed = config.closed ?? false;
  if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-3) {
    pts.pop();
    closed = true;
  }

  const curve = new THREE.CatmullRomCurve3(pts, closed, 'catmullrom', 0.5);
  const spans = closed ? pts.length : pts.length - 1;
  const sampleCount = Math.max(2, spans * config.segments);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= sampleCount; i++) {
    const u = i / sampleCount;
    // For a closed loop, reuse sample 0 at the seam so it stitches without a gap.
    const t = closed && i === sampleCount ? 0 : u;

    const center = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();

    // Level side vector, perpendicular to travel.
    const side = new THREE.Vector3().crossVectors(WORLD_UP, tangent);
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0); // vertical tangent fallback
    side.normalize();

    const up = WORLD_UP.clone();

    // Bank into the turn, proportional to how fast the tangent is rotating.
    if (banking > 0) {
      const ahead = curve.getTangentAt(closed ? (t + 1 / sampleCount) % 1 : Math.min(t + 1 / sampleCount, 1)).normalize();
      const turn = THREE.MathUtils.clamp(ahead.sub(tangent).dot(side) * 6, -1, 1);
      const bankAngle = turn * banking;
      side.applyAxisAngle(tangent, bankAngle);
      up.applyAxisAngle(tangent, bankAngle);
    }

    const left = center.clone().addScaledVector(side, halfWidth);
    const right = center.clone().addScaledVector(side, -halfWidth);

    positions.push(left.x, left.y, left.z, right.x, right.y, right.z);
    normals.push(up.x, up.y, up.z, up.x, up.y, up.z);
    uvs.push(0, u * spans, 1, u * spans);

    if (i > 0) {
      const a = (i - 1) * 2; // left[i-1]
      const b = a + 1;       // right[i-1]
      const c = i * 2;       // left[i]
      const d = c + 1;       // right[i]
      // Wound so face normals point up (matches procedural.tsx).
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  const vertices = new Float32Array(positions);
  const indexArray = new Uint32Array(indices);
  const normalArray = new Float32Array(normals);
  const uvArray = new Float32Array(uvs);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normalArray, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvArray, 2));
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));
  geometry.computeVertexNormals();

  return {
    geometry,
    vertices,
    indices: indexArray,
    normals: normalArray,
    uvs: uvArray,
    curve,
  };
}
