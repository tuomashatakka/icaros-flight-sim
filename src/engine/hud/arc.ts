import * as THREE from 'three'

/**
 * A ring segment in the XY plane, with `uv.x` running along the SWEEP and
 * `uv.y` across the band.
 *
 * That UV layout is the point: it lets the shared holo shader treat an arc's
 * `uFill` exactly as it treats a bar's, so a gauge fills by moving one uniform
 * rather than rebuilding geometry every frame.
 *
 * @param start - Start angle, radians, measured from +X and rising counter-clockwise.
 * @param sweep - Angular length, radians.
 */
export function createArcGeometry (
  innerRadius: number,
  outerRadius: number,
  start: number,
  sweep: number,
  segments = 96
): THREE.BufferGeometry {
  const positions         = new Float32Array((segments + 1) * 2 * 3)
  const uvs               = new Float32Array((segments + 1) * 2 * 2)
  const indices: number[] = []

  for (let i = 0; i <= segments; i++) {
    const t      = i / segments
    const angle  = start + sweep * t
    const cos    = Math.cos(angle)
    const sin    = Math.sin(angle)
    const base   = i * 6
    const uvBase = i * 4

    positions[base + 0] = cos * innerRadius
    positions[base + 1] = sin * innerRadius
    positions[base + 2] = 0
    positions[base + 3] = cos * outerRadius
    positions[base + 4] = sin * outerRadius
    positions[base + 5] = 0

    uvs[uvBase + 0] = t
    uvs[uvBase + 1] = 0
    uvs[uvBase + 2] = t
    uvs[uvBase + 3] = 1

    if (i < segments) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}

/**
 * Evenly spaced tick marks along an arc, as one geometry.
 *
 * Merged into a single buffer rather than one mesh per tick — a gauge bezel is
 * 20-odd marks and they are not worth 20 draw calls.
 */
export function createArcTicks (
  radius: number,
  length: number,
  start: number,
  sweep: number,
  count: number,
  width = 0.004
): THREE.BufferGeometry {
  const positions         = new Float32Array(count * 4 * 3)
  const uvs               = new Float32Array(count * 4 * 2)
  const indices: number[] = []

  for (let i = 0; i < count; i++) {
    const t     = count === 1 ? 0 : i / (count - 1)
    const angle = start + sweep * t
    const cos   = Math.cos(angle)
    const sin   = Math.sin(angle)

    // Tangent, so the mark keeps a constant width however far out it sits.
    const tx = -sin * width
    const ty = cos * width

    const inner  = radius
    const outer  = radius + length
    const base   = i * 12
    const uvBase = i * 8

    positions[base + 0]  = cos * inner - tx
    positions[base + 1]  = sin * inner - ty
    positions[base + 2]  = 0
    positions[base + 3]  = cos * inner + tx
    positions[base + 4]  = sin * inner + ty
    positions[base + 5]  = 0
    positions[base + 6]  = cos * outer - tx
    positions[base + 7]  = sin * outer - ty
    positions[base + 8]  = 0
    positions[base + 9]  = cos * outer + tx
    positions[base + 10] = sin * outer + ty
    positions[base + 11] = 0

    // Every vertex of a tick carries the tick's own sweep position, so ticks
    // light up as the gauge fills past them.
    for (let v = 0; v < 4; v++) {
      uvs[uvBase + v * 2]     = t
      uvs[uvBase + v * 2 + 1] = v < 2 ? 0 : 1
    }

    const a = i * 4
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}
