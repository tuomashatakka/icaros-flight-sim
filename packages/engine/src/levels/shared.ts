import * as THREE from 'three'
import type { SeededRng } from 'threejs-scene'


export { finaliseStaticScene } from '../render/static-scene'

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
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      emissive:            color,
      // Kept modest on purpose. This is a stripe running the whole length of
      // the road a few metres under the camera, so every point of emissive
      // intensity on it is a point of bloom across the entire frame — at 2.2 it
      // washed the track out to a flat pink and hid the thing it exists to
      // show.
      emissiveIntensity:   0.9,
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
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()

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

/**
 * The barriers, drawn.
 *
 * Built from the same `[L,R,…]` strip `ribbonWallColliders` reads, so the wall
 * you can see and the wall you hit are one wall. That matters more than it
 * sounds: the tracks shipped with barriers in neither, and adding them to the
 * physics alone would produce the worst possible version — an invisible fence
 * the ship bounces off for no reason a player can see.
 *
 * Two meshes rather than one: a dark solid face that reads as structure, and a
 * thin emissive cap along the top, which is what actually tells you where the
 * road goes at two hundred kilometres an hour. The cap is the only part that
 * feeds bloom.
 */
export function ribbonWalls (
  vertices: Float32Array,
  options: { height?: number; sink?: number; face?: string; cap?: string; maxLen?: number } = {}
): THREE.Group {
  const height = options.height ?? 6
  const sink   = options.sink ?? 1.5
  const maxLen = options.maxLen ?? 60

  const rings = Math.floor(vertices.length / 6)
  const at    = (i: number) => new THREE.Vector3(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2])

  const facePositions: number[] = []
  const faceIndices: number[]   = []
  const capPositions: number[]  = []
  const capIndices: number[]    = []

  const forward = new THREE.Vector3()
  const side    = new THREE.Vector3()
  const up      = new THREE.Vector3()

  for (const edge of [ 0, 1 ]) {
    let previous = -1

    for (let i = 0; i < rings; i++) {
      const here = at(i * 2 + edge)
      const next = i + 1 < rings ? at((i + 1) * 2 + edge) : null

      const left  = at(i * 2)
      const right = at(i * 2 + 1)
      side.subVectors(right, left)
      if (side.lengthSq() < 1e-8)
        continue

      // The segment's own up, so the barrier banks with the road instead of
      // standing vertically through it.
      forward.copy(next ? next.clone().sub(here) : here.clone().sub(at((i - 1) * 2 + edge)))
      if (forward.lengthSq() < 1e-8)
        continue
      up.crossVectors(side.clone().normalize(), forward.normalize())
        .normalize()

      const foot = here.clone().addScaledVector(up, -sink)
      const head = here.clone().addScaledVector(up, height - sink)

      const base = facePositions.length / 3
      facePositions.push(foot.x, foot.y, foot.z, head.x, head.y, head.z)

      const capBase = capPositions.length / 3
      const inward  = side.clone().normalize()
        .multiplyScalar(edge === 0 ? 0.5 : -0.5)
      capPositions.push(
        head.x, head.y, head.z,
        head.x + inward.x, head.y + inward.y, head.z + inward.z
      )

      // A gap in the strip — the jump — must not be stitched across.
      const broken = next !== null && here.distanceTo(next) > maxLen
      if (previous >= 0 && !broken) {
        faceIndices.push(previous, previous + 1, base, previous + 1, base + 1, base)
        capIndices.push(capBase - 2, capBase - 1, capBase, capBase - 1, capBase + 1, capBase)
      }
      previous = broken ? -1 : base
    }
  }

  const group = new THREE.Group()
  group.add(surface(facePositions, faceIndices, new THREE.MeshStandardMaterial({
    color:     options.face ?? '#141824',
    metalness: 0.2,
    roughness: 0.8,
    side:      THREE.DoubleSide,
  })))

  const capColour = options.cap ?? '#58f7ef'
  group.add(surface(capPositions, capIndices, new THREE.MeshStandardMaterial({
    color:             capColour,
    emissive:          capColour,
    emissiveIntensity: 1.5,
    roughness:         0.5,
    side:              THREE.DoubleSide,
  })))
  return group
}

function surface (positions: number[], indices: number[], material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return new THREE.Mesh(geometry, material)
}

/**
 * Gate posts, every checkpoint, in one draw call.
 *
 * Two per waypoint — one at each road edge — as a single `InstancedMesh`. A
 * sixteen-gate circuit is thirty-two posts, and thirty-two meshes is thirty-two
 * draw calls for something that is one geometry and one material; instanced it
 * is one, and the per-instance work is a matrix written once at build time and
 * never touched again.
 *
 * They earn their place twice over. Barrier caps tell you where the road goes;
 * these tell you where the next gate is, which is the other half of knowing
 * where to point the ship.
 */
export function gatePosts (
  waypoints: readonly (readonly [number, number, number])[],
  halfWidth: number,
  color: string,
  height = 7
): THREE.InstancedMesh {
  const count    = waypoints.length * 2
  const geometry = new THREE.BoxGeometry(0.5, height, 0.5)
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive:          color,
    // Low, because a post is a metre from the camera every time you cross a
    // gate and bloom does not care how small the geometry is.
    emissiveIntensity: 0.65,
    roughness:         0.5,
  })

  const mesh   = new THREE.InstancedMesh(geometry, material, count)
  const matrix = new THREE.Matrix4()
  const here   = new THREE.Vector3()
  const ahead  = new THREE.Vector3()
  const side   = new THREE.Vector3()
  const up     = new THREE.Vector3(0, 1, 0)
  const unit   = new THREE.Vector3(1, 1, 1)
  const level  = new THREE.Quaternion()
  const at     = new THREE.Vector3()

  for (let i = 0; i < waypoints.length; i++) {
    const point = waypoints[i]
    const next  = waypoints[(i + 1) % waypoints.length]
    here.set(point[0], point[1], point[2])
    ahead.set(next[0], next[1], next[2])

    side.subVectors(ahead, here).cross(up)
      .normalize()
    if (side.lengthSq() < 1e-8)
      side.set(1, 0, 0)

    for (const sign of [ 1, -1 ]) {
      at.copy(here).addScaledVector(side, sign * halfWidth)
      at.y += height * 0.5 - 1
      mesh.setMatrixAt(i * 2 + (sign > 0 ? 0 : 1), matrix.compose(at, level, unit))
    }
  }

  mesh.instanceMatrix.needsUpdate = true
  mesh.frustumCulled              = false
  mesh.castShadow                 = false
  return mesh
}
