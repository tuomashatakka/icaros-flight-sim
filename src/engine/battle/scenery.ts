/**
 * Static set-dressing for Apex Basin: the sky, the skyline, the wall panels and
 * the debris.
 *
 * Split out of `arena.ts` because that file owns the arena's *contract* — the
 * dimensions, the colliders and the spawn/zone data that the headless sim and
 * the tests import. None of this is load-bearing for a match; it exists so the
 * deck reads as a place rather than a grey plane, and keeping it here means the
 * Node-side importers never pull a sky dome in with the collider list.
 *
 * Everything is seeded off the arena's own `mulberry32` stream. `Math.random`
 * would put a different skyline in every replay of the same match.
 */

import * as THREE from 'three'
import { createHoloMaterial, HOLO } from '../hud/materials'
import { freezeStatic, reportDrawInventory } from '../render/static-scene'
import type { HoloMaterial } from '../hud/materials'


/** Well inside the camera's 1600 far plane, so the dome is never clipped. */
const SKY_RADIUS = 1450

export type Scenery = {
  update(elapsed: number): void;
  dispose(): void;
}

const SKY_VERTEX = /* glsl */`
varying vec3 vDir;

void main () {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * A vertical gradient with two soft nebula bands laid across it.
 *
 * Value noise rather than a texture: the dome is the first thing built and an
 * async image would pop in a second after the match starts. Three octaves is
 * enough because the whole thing is behind fog-free haze anyway.
 */
const SKY_FRAGMENT = /* glsl */`
varying vec3 vDir;

uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uNebula;
uniform vec3 uHaze;
uniform vec3 uSunDir;
uniform vec3 uSunColor;

float hash (vec3 p) {
  return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

float noise (vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n = mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z);
  return n;
}

void main () {
  float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 sky = mix(uHorizon, uZenith, pow(h, 0.7));

  float clouds = noise(vDir * 3.1) * 0.6 + noise(vDir * 7.3) * 0.3 + noise(vDir * 15.0) * 0.1;
  // Banded rather than isotropic, so it reads as a galactic plane instead of
  // uniform fuzz.
  float band = smoothstep(0.62, 0.0, abs(vDir.y - 0.12));
  sky += uNebula * pow(clouds, 2.2) * band * 1.5;

  // The glow where the deck meets the sky.
  //
  // A term in the dome rather than a ring of geometry: the obvious version is
  // an additive cylinder around the arena, and because it has to be wider than
  // the deck the camera ends up INSIDE it — which adds its colour to every
  // pixel of every frame. Same failure as the zone beacons in 07cff7e, one
  // scale up. Geometry the camera can enter cannot be additive.
  sky += uHaze * pow(smoothstep(0.30, 0.0, abs(vDir.y - 0.015)), 2.0) * 0.55;

  // A wide, soft bloom around the key light, which is where the arena's sense
  // of a direction of light now comes from.
  float sun = pow(max(dot(vDir, uSunDir), 0.0), 220.0);
  float halo = pow(max(dot(vDir, uSunDir), 0.0), 6.0);
  sky += uSunColor * (sun * 8.0 + halo * 0.35);

  gl_FragColor = vec4(sky, 1.0);
}
`

function buildSky (rng: () => number, sunAnchor: readonly [number, number, number]): THREE.Object3D {
  const group  = new THREE.Group()
  const sunDir = new THREE.Vector3(...sunAnchor).normalize()

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(SKY_RADIUS, 48, 32),
    new THREE.ShaderMaterial({
      uniforms: {
        uHorizon:  { value: new THREE.Color('#141a33') },
        uZenith:   { value: new THREE.Color('#04060f') },
        uNebula:   { value: new THREE.Color('#2b3f8f') },
        uHaze:     { value: new THREE.Color('#3f5cae') },
        uSunDir:   { value: sunDir },
        uSunColor: { value: new THREE.Color('#ffd8a8') },
      },
      vertexShader:   SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      side:           THREE.BackSide,
      depthWrite:     false,
      // The arena's fog ends at 1500 and the dome sits at 1450, so a fogged sky
      // would be a flat wash of the fog colour and nothing else.
      fog:            false,
    })
  )
  dome.renderOrder = -1
  group.add(dome)

  const count     = 3200
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    // Uniform on the sphere, then biased upward: stars below the deck are never
    // visible and just cost vertices.
    const u              = rng() * 1.6 - 0.35
    const theta          = rng() * Math.PI * 2
    const r              = Math.sqrt(Math.max(0, 1 - u * u))
    const rad            = SKY_RADIUS * (0.82 + rng() * 0.12)
    positions[i * 3]     = Math.cos(theta) * r * rad
    positions[i * 3 + 1] = u * rad
    positions[i * 3 + 2] = Math.sin(theta) * r * rad
  }

  const starGeo = new THREE.BufferGeometry()
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  // `sizeAttenuation: false`. At the dome's ~1200-unit radius an attenuated
  // point resolves to well under a pixel and the whole sky renders empty; stars
  // want a constant screen size anyway.
  group.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
    color:           '#dfe9ff',
    size:            2,
    sizeAttenuation: false,
    fog:             false,
    transparent:     true,
    opacity:         0.9,
    depthWrite:      false,
  })))

  return group
}

/**
 * The skyline, as ONE draw call.
 *
 * It used to be ~130 individual meshes plus a lit cap each. Instancing it is
 * what pays for the sky, the debris and the wall panels put together.
 */
function buildSkyline (rng: () => number, half: number): THREE.Object3D {
  const group                                                                                = new THREE.Group()
  const specs: Array<{ x: number; z: number; h: number; w: number; d: number; yaw: number }> = []

  for (let ring = 0; ring < 4; ring++) {
    const dist  = half + 26 + ring * 46
    const count = 34 + ring * 8
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2 + rng() * 0.06
      const cs    = Math.cos(angle)
      const sn    = Math.sin(angle)
      // Project the circle onto a square so the towers hug the wall line.
      const scale = 1 / Math.max(Math.abs(cs), Math.abs(sn))
      specs.push({
        x:   cs * scale * dist + (rng() - 0.5) * 22,
        z:   sn * scale * dist + (rng() - 0.5) * 22,
        h:   40 + rng() * (150 + ring * 70),
        w:   12 + rng() * 22,
        d:   0.7 + rng() * 0.7,
        yaw: rng() * Math.PI,
      })
    }
  }

  const towers = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#10131d', metalness: 0.45, roughness: 0.55 }),
    specs.length
  )
  const windows = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: '#6d80ff', transparent: true, opacity: 0.55, toneMapped: false, side: THREE.DoubleSide }),
    specs.length
  )

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3()

  specs.forEach((spec, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), spec.yaw)
    towers.setMatrixAt(i, m.compose(p.set(spec.x, spec.h / 2, spec.z), q, s.set(spec.w, spec.h, spec.w * spec.d)))

    // Every tower gets a strip; the dark ones are scaled to nothing rather than
    // branched out, because an InstancedMesh count is fixed at construction.
    const lit = rng() > 0.42
    towers.getMatrixAt(i, m)
    windows.setMatrixAt(i, new THREE.Matrix4().compose(
      p.set(spec.x, spec.h * (0.55 + rng() * 0.35), spec.z + spec.w * 0.52),
      q,
      lit ? s.set(spec.w * 0.7, 1.8, 1) : s.set(0, 0, 0)
    ))
  })

  towers.instanceMatrix.needsUpdate  = true
  windows.instanceMatrix.needsUpdate = true
  towers.castShadow                  = false
  group.add(towers, windows)
  return group
}

/**
 * A holographic light strip along the crown of the cliff.
 *
 * `createHoloMaterial` predates the canvas-facet HUD and now belongs to arena
 * scenery. It is exactly the right shader here: additive, scanlined, cheap. Two
 * things it needs forcing on:
 *
 * - `depthTest`, because its default is `false` and these would otherwise
 *   paint straight over the whole arena;
 * - a narrow band at the TOP of the wall rather than the full 44-unit face. A
 *   full-height additive panel is a 600-unit sheet running down the side of the
 *   play area, and in perspective it cuts a bright diagonal across everything
 *   you are trying to shoot at. Same lesson as the zone beacons in 07cff7e:
 *   additive geometry the camera can get near is a screen wash.
 */
type BuildWallPanelsReturnType = { group: THREE.Object3D; materials: HoloMaterial[] }

function buildWallPanels (half: number, wallIn: number): BuildWallPanelsReturnType {
  const group                     = new THREE.Group()
  const materials: HoloMaterial[] = []
  const inner                     = half - wallIn * 2

  const faces: Array<[number, number, number]> = [
    [ 0, inner - 0.4, 0 ],
    [ 0, -(inner - 0.4), Math.PI ],
    [ inner - 0.4, 0, -Math.PI / 2 ],
    [ -(inner - 0.4), 0, Math.PI / 2 ],
  ]

  const geometry = new THREE.PlaneGeometry(half * 2, 5)
  for (let parity = 0; parity < 2; parity++) {
    const material = createHoloMaterial({
      color:     parity === 0 ? HOLO.cyan : HOLO.violet,
      opacity:   0.38,
      scan:      70,
      gain:      0.7,
      depthTest: true,
    })
    materials.push(material)

    const panels   = new THREE.InstancedMesh(geometry, material, 2)
    const matrix   = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    const scale    = new THREE.Vector3(1, 1, 1)
    faces.filter((_, i) => i % 2 === parity).forEach(([ x, z, rot ], i) => {
      rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot)
      panels.setMatrixAt(i, matrix.compose(position.set(x, 47, z), rotation, scale))
    })
    panels.instanceMatrix.needsUpdate = true
    group.add(panels)
  }

  return { group, materials }
}

/**
 * Debris drifting above the deck.
 *
 * The whole field rotates as one group rather than re-composing 90 instance
 * matrices per frame — at this distance nobody can tell, and it keeps the
 * render phase free of a per-frame matrix loop.
 */
function buildDebris (rng: () => number, half: number): THREE.Object3D {
  const count = 90
  const mesh  = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: '#2a3048', metalness: 0.6, roughness: 0.5, flatShading: true }),
    count
  )

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3()

  for (let i = 0; i < count; i++) {
    const angle  = rng() * Math.PI * 2
    const radius = half * (0.25 + rng() * 0.9)
    const scale  = 1.4 + rng() * 5
    e.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI)
    mesh.setMatrixAt(i, m.compose(
      p.set(Math.cos(angle) * radius, 70 + rng() * 190, Math.sin(angle) * radius),
      q.setFromEuler(e),
      s.setScalar(scale)
    ))
  }
  mesh.instanceMatrix.needsUpdate = true
  return mesh
}

/**
 * Emissive structure painted onto the deck.
 *
 * The arena's readability problem is that 600x600 of flat plane gives the eye
 * nothing to judge distance or heading against once you are away from a mesa.
 * Concentric rings and radial spokes fix that for free — and unlike a tinted
 * area they cost almost no screen, which is the constraint the territory-line
 * comment in `arena.ts` was written about.
 *
 * Normal blending, not additive: these sit under the camera for most of a
 * match, and additive floor geometry is how you wash out a frame.
 */
function buildDeckTrim (half: number): THREE.Object3D {
  const group = new THREE.Group()

  const ring = (radius: number, width: number, colour: string, opacity: number) => {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(radius - width, radius, 96),
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
    )
    mesh.rotation.x = -Math.PI / 2
    mesh.position.y = 0.04
    return mesh
  }

  for (const [ r, w, o ] of [[ 90, 0.9, 0.22 ], [ 170, 0.7, 0.16 ], [ 250, 0.5, 0.11 ]] as Array<[number, number, number]>)
    group.add(ring(r, w, '#4d5a86', o))

  // Spokes, cut short of the centre so they do not pile up on the spire.
  const spokeMat = new THREE.MeshBasicMaterial({ color: '#3d4a72', transparent: true, opacity: 0.16, depthWrite: false, toneMapped: false })
  for (let i = 0; i < 8; i++) {
    const spoke      = new THREE.Mesh(new THREE.PlaneGeometry(half * 0.78, 0.6), spokeMat)
    spoke.rotation.x = -Math.PI / 2
    spoke.rotation.z = i / 8 * Math.PI * 2
    spoke.position.set(Math.cos(i / 8 * Math.PI * 2) * half * 0.52, 0.04, -Math.sin(i / 8 * Math.PI * 2) * half * 0.52)
    group.add(spoke)
  }

  // A lit kerb where the deck meets the cliff, so the wall reads as a boundary
  // rather than the point the fog happens to start.
  const kerbMat = new THREE.MeshBasicMaterial({ color: '#6f7fd4', transparent: true, opacity: 0.3, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
  const inner   = half - 14
  for (const [ x, z, rot ] of [
    [ 0, inner, 0 ], [ 0, -inner, 0 ], [ inner, 0, Math.PI / 2 ], [ -inner, 0, Math.PI / 2 ],
  ] as Array<[number, number, number]>) {
    const kerb      = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, 1.6), kerbMat)
    kerb.rotation.x = -Math.PI / 2
    kerb.rotation.z = rot
    kerb.position.set(x, 0.05, z)
    group.add(kerb)
  }

  return group
}

/**
 * A procedural panel texture for the deck.
 *
 * The arena reads as empty in the near field because 600x600 units of one flat
 * colour gives the eye nothing at all inside ~40 units, which is exactly where
 * the chase camera spends the match. The `GridHelper` only helps in the middle
 * distance — its lines converge to nothing underfoot.
 *
 * Drawn to a canvas rather than shipped as an image: it is a few hundred bytes
 * of code against a texture download that would pop in after the match starts.
 */
export function createDeckTexture (): THREE.CanvasTexture {
  const size   = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size

  const g      = canvas.getContext('2d')!

  g.fillStyle = '#14151f'
  g.fillRect(0, 0, size, size)

  // Deterministic: a seeded hash, not Math.random, so two runs of the same
  // match paint the same deck.
  let seed = 0x2f6e2b1
  const rnd = () => {
    seed = seed * 1664525 + 1013904223 >>> 0
    return seed / 0x100000000
  }

  // Plates at two scales, so the surface has a hierarchy instead of one grid.
  for (const [ step, alpha ] of [[ 128, 0.055 ], [ 64, 0.03 ]] as Array<[number, number]>)
    for (let y = 0; y < size; y += step)
      for (let x = 0; x < size; x += step) {
        g.fillStyle = `rgba(140,158,214,${alpha * rnd()})`
        g.fillRect(x + 1, y + 1, step - 2, step - 2)
      }

  g.strokeStyle = 'rgba(120,140,205,0.16)'
  g.lineWidth   = 2
  for (let i = 0; i <= size; i += 64) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, size); g.stroke()
    g.beginPath(); g.moveTo(0, i); g.lineTo(size, i); g.stroke()
  }

  // Hazard hatching in a few cells — asymmetry is what stops a tiled texture
  // from reading as tiled.
  g.strokeStyle = 'rgba(200,150,70,0.14)'
  g.lineWidth   = 3
  for (let n = 0; n < 5; n++) {
    const cx = Math.floor(rnd() * 8) * 64
    const cy = Math.floor(rnd() * 8) * 64
    for (let i = 0; i < 64; i += 10) {
      g.beginPath(); g.moveTo(cx + i, cy); g.lineTo(cx, cy + i); g.stroke()
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  // 20 tiles across 600 units — a 30-unit plate, about four ship lengths.
  texture.repeat.set(20, 20)
  texture.anisotropy = 8
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

type OptsType = { half: number; wallIn: number; sunAnchor: readonly [number, number, number]}

export function buildScenery (
  scene: THREE.Object3D,
  rng: () => number,
  opts: OptsType
): Scenery {
  const sky     = buildSky(rng, opts.sunAnchor)
  const skyline = buildSkyline(rng, opts.half)
  const debris  = buildDebris(rng, opts.half)
  const trim    = buildDeckTrim(opts.half)
  const panels  = buildWallPanels(opts.half, opts.wallIn)

  scene.add(sky, skyline, debris, trim, panels.group)
  for (const root of [ sky, skyline, trim, panels.group ])
    freezeStatic(root)
  // Debris is the sole moving scenery hierarchy; its immutable instances and
  // buffer bounds are still finalised while the parent rotation stays live.
  debris.traverse(child => {
    if (child instanceof THREE.InstancedMesh) {
      child.computeBoundingBox()
      child.computeBoundingSphere()
      child.matrixAutoUpdate = false
    }
  })

  const inventory = new THREE.Group()
  inventory.add(sky.clone(), skyline.clone(), debris.clone(), trim.clone(), panels.group.clone())
  reportDrawInventory('apex basin scenery', inventory)

  return {
    update (elapsed) {
      debris.rotation.y = elapsed * 0.006
      for (const material of panels.materials)
        material.uniforms.uTime.value = elapsed
    },

    dispose () {
      for (const root of [ sky, skyline, debris, trim, panels.group ]) {
        root.traverse(child => {
          const mesh = child as THREE.Mesh
          mesh.geometry?.dispose()

          const materials = Array.isArray(mesh.material) ? mesh.material : [ mesh.material ]
          for (const material of materials)
            material?.dispose()
        })
        root.removeFromParent()
      }
    },
  }
}
