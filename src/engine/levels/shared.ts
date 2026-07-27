import * as THREE from 'three'
import type { SeededRng } from 'threejs-scene'

/**
 * Glossy tarmac.
 *
 * This replaces drei's `MeshReflectorMaterial`, which was a planar mirror: it
 * derives one reflection plane from the mesh, but these tracks are banked,
 * ramped spline ribbons with no single plane — so the reflection was only ever
 * correct on the opening straight, at the cost of a full extra scene render per
 * frame. A low-roughness metal reading the PMREM env map plus the level's own
 * emissive rails gets most of the look for none of the cost.
 */
export function roadMaterial (color: string, metalness = 0.4, roughness = 0.45) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness,
    roughness,
    // Kept LOW deliberately. `standardLighting`'s env is a PMREM
    // RoomEnvironment — a bright studio box — so a metallic deck mirroring it at
    // full strength renders as glowing grey and washes the whole track out.
    // drei's reflector mirrored the dark scene instead, which is the look these
    // colours were chosen against.
    envMapIntensity: 0.25,
    side:            THREE.DoubleSide,
  })
}

/**
 * Emissive centreline rail, as a swept ribbon.
 *
 * drei's `<Line>` is meshline-backed; the plain `THREE.Line` equivalent ignores
 * `linewidth` on most platforms, and `Line2` needs a `resolution` uniform kept
 * in sync from a resize hook. Real geometry sidesteps both and — being actual
 * emissive surface area — feeds bloom the way the neon look wants.
 */
export function guideRail (
  points: THREE.Vector3[],
  color: string,
  width = 0.5,

  /**
   * Height above the centreline. Must clear the BANKED road surface: the ribbon
   * rotates about the tangent, so on a banked section the deck rises above the
   * spline point and a small lift leaves the rail buried, surfacing only in
   * patches. Depth-write is disabled below for the same reason.
   */
  lift = 0.45
): THREE.Mesh {
  const count             = points.length
  const positions         = new Float32Array(count * 2 * 3)
  const indices: number[] = []
  const up                = new THREE.Vector3(0, 1, 0)
  const forward           = new THREE.Vector3()
  const side              = new THREE.Vector3()

  for (let i = 0; i < count; i++) {
    const p    = points[i]
    const next = points[(i + 1) % count]
    const prev = points[(i - 1 + count) % count]
    forward.subVectors(next, prev).normalize()
    side.crossVectors(forward, up).normalize()
      .multiplyScalar(width / 2)

    const o          = i * 6
    positions[o + 0] = p.x - side.x
    positions[o + 1] = p.y + lift
    positions[o + 2] = p.z - side.z
    positions[o + 3] = p.x + side.x
    positions[o + 4] = p.y + lift
    positions[o + 5] = p.z + side.z

    if (i < count - 1) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      emissive:            color,
      emissiveIntensity:   2.2,
      roughness:           0.6,
      side:                THREE.DoubleSide,
      // Sits flush on a surface it can never exactly match, so bias it out of
      // the depth fight rather than z-fighting along the whole track.
      polygonOffset:       true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits:  -2,
    })
  )
  mesh.renderOrder = 1
  return mesh
}

/**
 * Starfield backdrop — replaces drei's `<Stars>`.
 *
 * Positions come from the injected seeded rng (forked per consumer) rather than
 * `Math.random`, so the sky is identical across reloads and replays.
 */
export function starfield (rng: SeededRng, count = 6000, inner = 430, outer = 570): THREE.Points {
  const positions = new Float32Array(count * 3)
  const stars     = rng.fork('stars')

  for (let i = 0; i < count; i++) {
    // Uniform direction on a sphere, then a random shell radius.
    const u              = stars.next() * 2 - 1
    const theta          = stars.next() * Math.PI * 2
    const r              = Math.sqrt(1 - u * u)
    const radius         = inner + stars.next() * (outer - inner)
    positions[i * 3 + 0] = Math.cos(theta) * r * radius
    positions[i * 3 + 1] = u * radius
    positions[i * 3 + 2] = Math.sin(theta) * r * radius
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))

  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: true, fog: false })
  )
}

/** Point light helper — the levels place a lot of these. */
export function pointLight (
  color: string,
  intensity: number,
  distance: number,
  position: [number, number, number]
): THREE.PointLight {
  const light = new THREE.PointLight(color, intensity, distance)
  light.position.set(position[0], position[1], position[2])
  return light
}
