import * as THREE from 'three'
import type { SeededRng } from 'threejs-scene'


/**
 * A ship coming apart.
 *
 * Three things at once, because any one of them alone reads as a placeholder:
 * a flash and a shockwave ring, a spray of sparks, and the hull itself cut into
 * pieces that are thrown outward and tumble away under gravity.
 *
 * The pieces are the part worth explaining. They are the REAL hull geometry,
 * partitioned by triangle: each mesh's triangles are bucketed by which side of
 * the hull's own x and z axes their centroid falls on, and each bucket becomes a
 * standalone non-indexed geometry sharing the source material. So a wreck is
 * recognisably the ship that just died — its nose, its wings, its engine block —
 * rather than a bag of generic cubes.
 *
 * Slicing allocates, so it happens once per hull geometry and is cached. A
 * wreck mid-race must not be the frame that builds four buffers; `prime` pays
 * that cost at mount time for the hull the local player is flying, and every
 * later wreck of the same ship is a matrix write.
 *
 * Nothing here touches rapier. Debris does not need to collide with anything —
 * it needs to leave the frame looking violent — and adding sixteen bodies to a
 * deterministic world for two seconds of cosmetics is how a replay stops
 * matching.
 */

export type WreckField = {
  group: THREE.Group;

  /**
   * Slice a hull ahead of time, so the wreck itself allocates nothing.
   *
   * Safe to call repeatedly; the second call for a geometry is a map lookup.
   */
  prime(hull: THREE.Object3D): void;

  /** Blow a hull apart at a pose, carrying its velocity into the debris. */
  burst(hull: THREE.Object3D, velocity: THREE.Vector3, colour?: THREE.ColorRepresentation): void;

  update(delta: number): void;
  dispose(): void;
}

type Piece = {
  mesh:     THREE.Mesh;
  velocity: THREE.Vector3;
  spin:     THREE.Vector3;
  life:     number;
  span:     number;
}

/** How long debris survives, and how long the flash does. */
const DEBRIS_LIFE = 2.6
const FLASH_LIFE  = 0.55

/** Sparks per burst, and how long one lives. */
const SPARKS     = 90
const SPARK_LIFE = 1.1

const GRAVITY = 16

const SPARK_VERTEX = /* glsl */`
attribute float aLife;
attribute float aSize;
varying float vLife;

void main () {
  vLife = aLife;
  vec4 view = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * view;
  gl_PointSize = aSize * (260.0 / max(-view.z, 1.0)) * vLife;
}
`

const SPARK_FRAGMENT = /* glsl */`
uniform vec3 uColor;
varying float vLife;

void main () {
  if (vLife <= 0.0) discard;
  // Round, hot in the middle, gone at the rim.
  vec2 d = gl_PointCoord - 0.5;
  float r = 1.0 - smoothstep(0.18, 0.5, length(d));
  if (r <= 0.0) discard;
  gl_FragColor = vec4(uColor * (0.6 + vLife * 1.8), r * vLife);
}
`

/**
 * Cut one geometry into four along its own x and z.
 *
 * Triangles are assigned whole, by centroid, so no piece has an open edge where
 * a triangle was split — cheaper than a real plane cut and, on a hull this size,
 * indistinguishable once the pieces are tumbling.
 */
function sliceGeometry (source: THREE.BufferGeometry): THREE.BufferGeometry[] {
  const positions = source.getAttribute('position')
  if (!positions)
    return []

  const index                                                    = source.getIndex()
  const count                                                    = index ? index.count : positions.count
  const normals                                                  = source.getAttribute('normal')
  const buckets: Array<{ position: number[]; normal: number[] }> = [
    { position: [], normal: []},
    { position: [], normal: []},
    { position: [], normal: []},
    { position: [], normal: []},
  ]

  for (let i = 0; i < count; i += 3) {
    const a = index ? index.getX(i) : i
    const b = index ? index.getX(i + 1) : i + 1
    const c = index ? index.getX(i + 2) : i + 2

    const cx     = (positions.getX(a) + positions.getX(b) + positions.getX(c)) / 3
    const cz     = (positions.getZ(a) + positions.getZ(b) + positions.getZ(c)) / 3
    const bucket = buckets[(cx >= 0 ? 1 : 0) + (cz >= 0 ? 2 : 0)]

    for (const vertex of [ a, b, c ]) {
      bucket.position.push(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex))
      if (normals)
        bucket.normal.push(normals.getX(vertex), normals.getY(vertex), normals.getZ(vertex))
    }
  }

  return buckets
    .filter(bucket => bucket.position.length >= 9)
    .map(bucket => {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(bucket.position, 3))
      if (bucket.normal.length === bucket.position.length)
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(bucket.normal, 3))
      else
        geometry.computeVertexNormals()
      geometry.computeBoundingSphere()
      return geometry
    })
}

export function createWreckField (rng: SeededRng): WreckField {
  const group = new THREE.Group()
  group.name  = 'wreck-field'

  const random = rng.fork('wreck')
  const spread = () => random.next() * 2 - 1

  const slices          = new Map<THREE.BufferGeometry, THREE.BufferGeometry[]>()
  const pieces: Piece[] = []

  // --- flash ---------------------------------------------------------------
  const flashMaterial = new THREE.MeshBasicMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  })
  const ringMaterial = new THREE.MeshBasicMaterial({
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  })
  const flash     = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), flashMaterial)
  const ring      = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 48), ringMaterial)
  ring.rotation.x = -Math.PI / 2

  const flashRoot = new THREE.Group()
  flashRoot.add(flash, ring)
  flashRoot.visible     = false
  flashRoot.renderOrder = 860
  group.add(flashRoot)

  let flashLife = 0

  // --- sparks --------------------------------------------------------------
  const sparkPositions = new Float32Array(SPARKS * 3)
  const sparkLives     = new Float32Array(SPARKS)
  const sparkSizes     = new Float32Array(SPARKS)
  const sparkVelocity  = new Float32Array(SPARKS * 3)

  const sparkGeometry = new THREE.BufferGeometry()
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3))
  sparkGeometry.setAttribute('aLife', new THREE.BufferAttribute(sparkLives, 1))
  sparkGeometry.setAttribute('aSize', new THREE.BufferAttribute(sparkSizes, 1))
  sparkGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6)

  const sparkMaterial = new THREE.ShaderMaterial({
    uniforms:       { uColor: { value: new THREE.Color('#ffb057') }},
    vertexShader:   SPARK_VERTEX,
    fragmentShader: SPARK_FRAGMENT,
    transparent:    true,
    blending:       THREE.AdditiveBlending,
    depthWrite:     false,
    toneMapped:     false,
  })
  const sparks         = new THREE.Points(sparkGeometry, sparkMaterial)
  sparks.frustumCulled = false
  sparks.renderOrder   = 861
  group.add(sparks)

  const _world  = new THREE.Vector3()
  const _origin = new THREE.Vector3()
  const _scale  = new THREE.Vector3()
  const _quat   = new THREE.Quaternion()

  function slicesFor (mesh: THREE.Mesh): THREE.BufferGeometry[] {
    let cut = slices.get(mesh.geometry)
    if (!cut) {
      cut = sliceGeometry(mesh.geometry)
      slices.set(mesh.geometry, cut)
    }
    return cut
  }

  function hullMeshes (hull: THREE.Object3D): THREE.Mesh[] {
    const found: THREE.Mesh[] = []
    hull.traverse(child => {
      const mesh = child as THREE.Mesh
      // Skip the thruster plumes and other tiny billboards: they are already
      // additive quads and a tumbling one reads as a bug.
      if (mesh.isMesh && mesh.visible && mesh.geometry?.getAttribute('position')?.count > 60)
        found.push(mesh)
    })
    return found
  }

  return {
    group,

    prime (hull) {
      for (const mesh of hullMeshes(hull))
        slicesFor(mesh)
    },

    burst (hull, velocity, colour = '#ffb057') {
      hull.updateWorldMatrix(true, true)
      hull.getWorldPosition(_origin)

      flashMaterial.color.set(colour)
      ringMaterial.color.set(colour)
      sparkMaterial.uniforms.uColor.value.set(colour)
      flashRoot.position.copy(_origin)
      flashRoot.visible = true
      flashLife         = 0

      for (let i = 0; i < SPARKS; i++) {
        sparkPositions[i * 3 + 0] = _origin.x
        sparkPositions[i * 3 + 1] = _origin.y
        sparkPositions[i * 3 + 2] = _origin.z

        // Outward, biased upward, plus whatever the ship was already doing.
        const speed              = 9 + random.next() * 26
        const dir                = new THREE.Vector3(spread(), random.next() * 1.1 + 0.15, spread()).normalize()
        sparkVelocity[i * 3 + 0] = dir.x * speed + velocity.x * 0.45
        sparkVelocity[i * 3 + 1] = dir.y * speed + velocity.y * 0.45
        sparkVelocity[i * 3 + 2] = dir.z * speed + velocity.z * 0.45

        sparkLives[i] = 1
        sparkSizes[i] = 0.5 + random.next() * 1.5
      }
      sparkGeometry.getAttribute('position').needsUpdate = true
      sparkGeometry.getAttribute('aLife').needsUpdate    = true
      sparkGeometry.getAttribute('aSize').needsUpdate    = true

      for (const mesh of hullMeshes(hull)) {
        mesh.matrixWorld.decompose(_world, _quat, _scale)

        const material = mesh.material

        for (const geometry of slicesFor(mesh)) {
          const piece = new THREE.Mesh(geometry, material)
          piece.position.copy(_world)
          piece.quaternion.copy(_quat)
          piece.scale.copy(_scale)
          piece.castShadow    = false
          piece.receiveShadow = false
          group.add(piece)

          // Thrown along the piece's own offset from the hull centre, so the
          // nose goes forward and the wings go outward — the split is spatial,
          // so the direction it implies is the right one for free.
          const centre = geometry.boundingSphere?.center ?? new THREE.Vector3()
          const away   = centre.clone().applyQuaternion(_quat)
            .normalize()
          if (away.lengthSq() < 1e-6)
            away.set(spread(), 1, spread()).normalize()

          pieces.push({
            mesh:     piece,
            velocity: away.multiplyScalar(6 + random.next() * 11)
              .add(velocity.clone().multiplyScalar(0.8))
              .add(new THREE.Vector3(0, 5 + random.next() * 5, 0)),
            spin: new THREE.Vector3(spread(), spread(), spread()).multiplyScalar(7),
            life: 0,
            span: DEBRIS_LIFE * (0.75 + random.next() * 0.5),
          })
        }
      }
    },

    update (delta) {
      if (flashRoot.visible) {
        flashLife += delta

        const t = flashLife / FLASH_LIFE
        if (t >= 1)
          flashRoot.visible = false
        else {
          const fade = 1 - t
          flash.scale.setScalar(1.2 + t * 5)
          flashMaterial.opacity = fade * fade
          ring.scale.setScalar(1.5 + t * 22)
          ringMaterial.opacity = fade * 0.55
        }
      }

      let sparksLive = false
      for (let i = 0; i < SPARKS; i++) {
        if (sparkLives[i] <= 0)
          continue

        sparksLive = true
        sparkLives[i] = Math.max(0, sparkLives[i] - delta / SPARK_LIFE)
        sparkVelocity[i * 3 + 1] -= GRAVITY * delta

        // Air drag, so the spray decelerates into a shower instead of flying
        // off in straight lines.
        const drag = Math.exp(-1.6 * delta)
        for (let axis = 0; axis < 3; axis++) {
          sparkVelocity[i * 3 + axis] *= drag
          sparkPositions[i * 3 + axis] += sparkVelocity[i * 3 + axis] * delta
        }
      }
      if (sparksLive) {
        sparkGeometry.getAttribute('position').needsUpdate = true
        sparkGeometry.getAttribute('aLife').needsUpdate    = true
      }

      for (let i = pieces.length - 1; i >= 0; i--) {
        const piece = pieces[i]
        piece.life += delta

        if (piece.life >= piece.span) {
          group.remove(piece.mesh)
          pieces.splice(i, 1)
          continue
        }

        piece.velocity.y -= GRAVITY * delta
        piece.mesh.position.addScaledVector(piece.velocity, delta)
        piece.mesh.rotateX(piece.spin.x * delta)
        piece.mesh.rotateY(piece.spin.y * delta)
        piece.mesh.rotateZ(piece.spin.z * delta)

        // Shrunk away rather than faded: the hull's materials are shared with
        // the living ship, so turning their opacity down would take the ship
        // with them.
        const tail = 1 - Math.max(0, (piece.life - piece.span * 0.6) / (piece.span * 0.4))
        piece.mesh.scale.setScalar(tail * tail)
      }
    },

    dispose () {
      for (const piece of pieces)
        group.remove(piece.mesh)
      pieces.length = 0
      for (const cut of slices.values())
        for (const geometry of cut)
          geometry.dispose()
      slices.clear()
      flash.geometry.dispose()
      ring.geometry.dispose()
      flashMaterial.dispose()
      ringMaterial.dispose()
      sparkGeometry.dispose()
      sparkMaterial.dispose()
    },
  }
}
