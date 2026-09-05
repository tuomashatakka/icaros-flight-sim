import * as THREE from 'three'

/**
 * A pooled line buffer you draw vectors into.
 *
 * Extracted from the dev overlay once the crash lab needed the same arrows: two
 * implementations of "draw a force" would have drifted, and the whole point of
 * the lab is that what you watch is what the assertions ran against.
 *
 * One `LineSegments` per instance, so a whole layer costs one draw call however
 * many arrows go into it. All scratch is private — `arrow()` used to share
 * vectors with its callers, and drawing the first axis of a triad silently
 * overwrote the other two.
 */

export type VectorLines = {
  object: THREE.LineSegments;

  /** Reset the cursor. Call once per frame before drawing. */
  begin (): void;

  segment (a: THREE.Vector3, b: THREE.Vector3, hex: number): void;

  /** Shaft plus two barbs. Degenerate vectors are skipped, not drawn as dots. */
  arrow (from: THREE.Vector3, vector: THREE.Vector3, hex: number): void;

  /** Publish what was drawn. Anything past the cursor stops rendering. */
  end (): void;
  dispose (): void;
}

const _tip   = new THREE.Vector3()
const _shaft = new THREE.Vector3()
const _barb  = new THREE.Vector3()
const _side  = new THREE.Vector3()
const _perp  = new THREE.Vector3()
const _dir   = new THREE.Vector3()
const _col   = new THREE.Color()

export type VectorLinesOptions = {

  /** Draw through geometry. On for debug layers, off when it should be occluded. */
  depthTest?: number extends never ? never : boolean;
  opacity?:   number;
}

export function createVectorLines (capacity: number, options: VectorLinesOptions = {}): VectorLines {
  const { depthTest = false, opacity = 0.9 } = options

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3))

  const object = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ vertexColors: true, depthTest, transparent: true, opacity })
  )
  // Debug geometry must survive the camera driving away from the origin; three's
  // frustum culling otherwise hides it the moment the stale bounding sphere
  // leaves view, which reads as "the overlay is broken".
  object.frustumCulled = false
  object.renderOrder   = 999

  const position = geometry.getAttribute('position') as THREE.BufferAttribute
  const colour   = geometry.getAttribute('color') as THREE.BufferAttribute
  const pos      = position.array as Float32Array
  const col      = colour.array as Float32Array
  let cursor     = 0

  const api: VectorLines = {
    object,

    begin () {
      cursor = 0
    },

    segment (a, b, hex) {
      if (cursor + 2 > capacity)
        return
      pos.set([ a.x, a.y, a.z, b.x, b.y, b.z ], cursor * 3)
      _col.setHex(hex)
      col.set([ _col.r, _col.g, _col.b, _col.r, _col.g, _col.b ], cursor * 3)
      cursor += 2
    },

    arrow (from, vector, hex) {
      const length = vector.length()
      if (length < 1e-3)
        return

      _tip.copy(from).add(vector)
      api.segment(from, _tip, hex)

      _dir.copy(vector).multiplyScalar(1 / length)
      // Any perpendicular will do; cross with world up unless the vector IS up.
      _perp.set(0, 1, 0)
      if (Math.abs(_dir.y) > 0.95)
        _perp.set(1, 0, 0)
      _side.crossVectors(_dir, _perp).normalize()

      const head = Math.min(length * 0.22, 0.9)
      _shaft.copy(_tip).addScaledVector(_dir, -head)
      api.segment(_tip, _barb.copy(_shaft).addScaledVector(_side, head * 0.45), hex)
      api.segment(_tip, _barb.copy(_shaft).addScaledVector(_side, -head * 0.45), hex)
    },

    end () {
      position.needsUpdate = true
      colour.needsUpdate   = true
      geometry.setDrawRange(0, cursor)
    },

    dispose () {
      object.removeFromParent()
      geometry.dispose();
      (object.material as THREE.Material).dispose()
    },
  }

  return api
}

/** One colour per force kind, so a glance at the arrows says which system fired. */
export const FORCE_COLOURS: Record<string, number> = {
  main:     0xff6b35,
  retro:    0x4cc9f0,
  lateral:  0xf72585,
  rcs:      0xffd166,
  lift:     0x06d6a0,
  airbrake: 0xb5179e,
  drag:     0x8d99ae,
  attitude: 0x9d4edd,
  wind:     0x90e0ef,
}

export const NET_FORCE_COLOUR  = 0xffffff
export const NET_TORQUE_COLOUR = 0xff0054

/**
 * Metres of arrow per newton.
 *
 * Linear rather than logarithmic on purpose: the reason to draw these is to see
 * that two forces which should balance are the same length, and a log scale
 * hides exactly that.
 */
export const FORCE_SCALE  = 1 / 800
export const TORQUE_SCALE = 1 / 2000
export const MAX_ARROW    = 14
