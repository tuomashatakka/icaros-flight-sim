import * as THREE from 'three'
import { PROP_CATALOGUE } from 'Ȼprops'
import type { PropKind, PropPlacement } from 'Ȼprops'


/**
 * Props, drawn.
 *
 * `Ȼprops` says what a prop IS — its name, its category, its collider, its
 * accent. This says what it looks like, and it is the only file that knows,
 * because `core` may not touch three.js and the compiler that turns placements
 * into colliders must run on a server that draws nothing.
 *
 * Everything is procedural: boxes, cylinders, cones and planes assembled into
 * silhouettes. A track editor that needs an asset pipeline before it can place a
 * barrier is an editor nobody uses.
 *
 * ONE DRAW CALL PER KIND. Placements are grouped by kind and merged into a
 * single `InstancedMesh`, so a hundred cones is one draw rather than a hundred.
 * That is what makes it reasonable to dress a track properly rather than
 * sprinkling six objects and calling it done.
 */

type Build = () => THREE.BufferGeometry

const box = (x: number, y: number, z: number, offsetY = 0): THREE.BufferGeometry =>
  new THREE.BoxGeometry(x, y, z).translate(0, y / 2 + offsetY, 0)

const tube = (radius: number, height: number, sides = 10, offsetY = 0): THREE.BufferGeometry =>
  new THREE.CylinderGeometry(radius, radius, height, sides).translate(0, height / 2 + offsetY, 0)

function merge (parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Hand-rolled rather than `BufferGeometryUtils.mergeGeometries`, because these
  // parts are built from different primitive constructors and do not all carry
  // the same attribute set — the utility refuses that outright.
  const positions: number[] = []
  const normals: number[]   = []

  for (const part of parts) {
    const geometry = part.index ? part.toNonIndexed() : part
    const position = geometry.getAttribute('position')
    const normal   = geometry.getAttribute('normal')

    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i))
      normals.push(normal?.getX(i) ?? 0, normal?.getY(i) ?? 1, normal?.getZ(i) ?? 0)
    }
    if (geometry !== part)
      geometry.dispose()
    part.dispose()
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  merged.computeBoundingSphere()
  return merged
}

/** How each kind is assembled. Heights match `PROP_CATALOGUE`. */
const BUILDERS: Record<PropKind, Build> = {
  'pylon': () => merge([ tube(1.1, 16, 6), box(3, 1.2, 3) ]),

  'archway': () => merge([
    box(2.4, 16, 2.4).translate(-13, 0, 0),
    box(2.4, 16, 2.4).translate(13, 0, 0),
    box(28, 2.4, 2.8, 16),
  ]),

  'gantry': () => merge([
    box(1.8, 12, 1.8).translate(-15, 0, 0),
    box(1.8, 12, 1.8).translate(15, 0, 0),
    box(32, 1.2, 3.4, 12),
    box(30, 0.5, 0.5, 10),
  ]),

  'tower': () => merge([
    box(6, 26, 6),
    box(3.4, 10, 3.4, 26),
    tube(0.4, 8, 6, 36),
  ]),

  'billboard': () => merge([
    box(1.4, 7, 1.4).translate(-6, 0, 0),
    box(1.4, 7, 1.4).translate(6, 0, 0),
    box(18, 9, 0.5, 7),
  ]),

  'pipe-run': () => merge([
    tube(1.4, 24, 12).rotateZ(Math.PI / 2)
      .translate(0, 2.4, 0),
    box(1.4, 2.4, 2.4).translate(-9, 0, 0),
    box(1.4, 2.4, 2.4).translate(9, 0, 0),
  ]),

  'barrier-block': () => merge([ box(6, 2.4, 2), box(6.6, 0.5, 2.4, 2.4) ]),

  'tyre-stack': () => merge([
    tube(1.6, 1, 12),
    tube(1.5, 1, 12, 1),
    tube(1.35, 1, 12, 2),
  ]),

  'chicane-cone': () => merge([
    new THREE.ConeGeometry(0.75, 2, 10).translate(0, 1, 0),
    box(1.5, 0.2, 1.5),
  ]),

  'jump-ramp': () => {
    // A wedge, authored as a scaled box shear rather than a custom buffer: the
    // ramp face is what matters and a box sheared along +z gives it exactly.
    const wedge    = new THREE.BoxGeometry(14, 4, 18)
    const position = wedge.getAttribute('position')
    for (let i = 0; i < position.count; i++) {
      const z = position.getZ(i)
      if (position.getY(i) > 0)
        position.setY(i, z > 0 ? 2 : -2)
    }
    position.needsUpdate = true
    wedge.computeVertexNormals()
    return wedge.translate(0, 2, 0)
  },

  'boost-pad': () => box(8, 0.3, 14),

  'spike-strip': () => {
    const parts = [ box(10, 0.5, 2) ]
    for (let i = -4; i <= 4; i++)
      parts.push(new THREE.ConeGeometry(0.35, 1.4, 6).translate(i * 1.1, 1.2, 0))
    return merge(parts)
  },

  'rock-spire': () => merge([
    new THREE.ConeGeometry(6, 22, 7).translate(0, 11, 0),
    new THREE.ConeGeometry(3, 9, 6).translate(4, 4.5, 2),
  ]),

  'wreck-hulk': () => merge([
    box(9, 3.6, 16),
    box(5, 2.4, 6, 3.6).translate(0, 0, -3),
    tube(1, 5, 6).rotateX(0.6)
      .translate(0, 3, 6),
  ]),

  'crate-stack': () => merge([
    box(4.4, 2.2, 4.4),
    box(3.4, 2, 3.4, 2.2).translate(0.5, 0, 0.4),
  ]),

  'antenna-mast': () => merge([
    tube(0.5, 24, 6),
    box(6, 0.3, 0.3, 18),
    box(4, 0.3, 0.3, 21),
  ]),

  'satellite-dish': () => merge([
    tube(0.8, 5, 8),
    new THREE.SphereGeometry(4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.4)
      .rotateX(Math.PI * 0.8)
      .translate(0, 6.5, 0),
  ]),

  'light-mast': () => merge([
    tube(0.6, 18, 6),
    box(4.4, 1.4, 1.2, 18),
  ]),

  'holo-sign': () => merge([
    box(0.6, 3, 0.6),
    box(11, 6, 0.2, 3.4),
  ]),

  'banner-flag': () => merge([
    tube(0.35, 12, 6),
    box(0.2, 5, 6, 6).translate(0, 0, 3),
  ]),

  'fan-vent': () => merge([
    tube(3.4, 1.2, 14),
    box(6.4, 0.3, 0.6, 1.2),
    box(0.6, 0.3, 6.4, 1.2),
  ]),

  'beacon': () => merge([
    tube(0.7, 4, 8),
    new THREE.IcosahedronGeometry(1.3, 0).translate(0, 5, 0),
  ]),
}

/** Kinds drawn as their own light source rather than as lit surface. */
const EMISSIVE: ReadonlySet<PropKind> = new Set<PropKind>([
  'boost-pad', 'holo-sign', 'beacon', 'light-mast', 'billboard', 'banner-flag',
])

const geometries = new Map<PropKind, THREE.BufferGeometry>()

function geometryFor (kind: PropKind): THREE.BufferGeometry {
  let geometry = geometries.get(kind)
  if (!geometry) {
    geometry = BUILDERS[kind]()
    geometries.set(kind, geometry)
  }
  return geometry
}

/**
 * Whether a geometry belongs to the shared per-kind cache.
 *
 * Callers that tear a scene down have to skip these: the cache is module-level
 * and reused by every later `buildProps`, so disposing one takes the props out
 * of the next scene with it. The forge's 3D preview is exactly that caller — it
 * rebuilds on every edit.
 */
export function isSharedPropGeometry (geometry: THREE.BufferGeometry): boolean {
  for (const cached of geometries.values())
    if (cached === geometry)
      return true
  return false
}

/**
 * Every placement, as one instanced mesh per kind.
 *
 * Colour is per instance through `setColorAt`, which is why a placement may
 * override its catalogue accent without costing a second draw call. Emissive
 * cannot vary per instance, so the two lists above are split by material rather
 * than by tint.
 */
export function buildProps (placements: readonly PropPlacement[]): THREE.Group {
  const group = new THREE.Group()
  group.name  = 'props'

  const byKind = new Map<PropKind, PropPlacement[]>()
  for (const placement of placements) {
    if (!(placement.kind in PROP_CATALOGUE))
      continue

    const list = byKind.get(placement.kind) ?? []
    list.push(placement)
    byKind.set(placement.kind, list)
  }

  const matrix   = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const scale    = new THREE.Vector3()
  const colour   = new THREE.Color()
  const axis     = new THREE.Vector3(0, 1, 0)

  for (const [ kind, list ] of byKind) {
    const def      = PROP_CATALOGUE[kind]
    const emissive = EMISSIVE.has(kind)
    const material = new THREE.MeshStandardMaterial({
      color:             def.color,
      emissive:          emissive ? def.color : '#000000',
      emissiveIntensity: emissive ? 0.8 : 0,
      metalness:         emissive ? 0 : 0.25,
      roughness:         emissive ? 0.4 : 0.75,
      vertexColors:      false,
    })

    const mesh = new THREE.InstancedMesh(geometryFor(kind), material, list.length)
    mesh.name  = `props:${kind}`

    list.forEach((placement, index) => {
      position.set(placement.x, placement.y, placement.z)
      rotation.setFromAxisAngle(axis, THREE.MathUtils.degToRad(placement.yaw))
      scale.setScalar(placement.scale || 1)
      mesh.setMatrixAt(index, matrix.compose(position, rotation, scale))
      mesh.setColorAt(index, colour.set(placement.color ?? def.color))
    })

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor)
      mesh.instanceColor.needsUpdate = true
    mesh.castShadow    = !emissive
    mesh.receiveShadow = !emissive
    group.add(mesh)
  }

  return group
}
