/**
 * The Apex Basin's meshes.
 *
 * Split out of `arena.ts` when the arena became a package: the server builds
 * the same colliders, spawns and control points this file decorates, and it
 * must never load `three` to do it. Keyed by arena id so a second arena is a
 * new entry rather than a new branch.
 */

import * as THREE from 'three'
import { BATTLE_TEAMS, NEUTRAL_COLOR, TEAM_COLORS, plateauColliders } from '@crash-velocity/battle/arena'

import { buildScenery, createDeckTexture } from './scenery'
import { finaliseStaticScene } from '../render/static-scene'

import type { BattleArena, PlateauDef } from '@crash-velocity/battle/arena'
import type { SceneContext } from 'threejs-scene'
import type { Scenery } from './scenery'
import type { EnvironmentOverrides } from '../scenes/environment'


// Dimensions the meshes need. They mirror the arena data rather than importing
//  private constants from it; `apexArena().half` is the authority for collision.
const HALF                                 = 300
const WALL_IN                              = 6
const WALL_H                               = 26 // half-height: a 52-unit cliff no ramp launch clears
const FOG: [string, number, number]        = [ '#0d1120', 340, 1500 ]
const SUN_ANCHOR: [number, number, number] = [ -430, 300, 1150 ]

/**
 * How the arena differs from `DEFAULT_ENVIRONMENT`.
 *
 * Sky and fog come off the arena data — the server carries those as plain
 * numbers and there is no reason for two sources of the same colour — while the
 * fill tint and the shadow frustum are the renderer's alone.
 */
export function arenaEnvironment (arena: BattleArena): EnvironmentOverrides {
  return {
    background: arena.background,
    fog:        arena.fog,
    hemi:       { sky: '#93a6ff', ground: '#141726' },

    // The deck is 600 across and the sun follows the local ship, so a race-sized
    // frustum leaves every other hull outside the shadow box, casting nothing.
    sun: { frustum: 110 },
  }
}

/** Build the scene content for an arena. */
export function buildArenaVisual (ctx: SceneContext, arena: BattleArena): Scenery {
  return buildApexVisual(ctx, arena.plateaus, arena.bases)
}


function mulberry32 (seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = a + 0x6d2b79f5 | 0

    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

/** Deck, mesas, cliff ring and the skyline behind it. */
function buildApexVisual (
  ctx: SceneContext,
  plateaus: PlateauDef[],
  bases: BattleArena['bases']
): Scenery {
  const scene = ctx.scene
  const root  = new THREE.Group()
  const rng   = mulberry32(0xa9e5)

  const deckMat       = new THREE.MeshStandardMaterial({
    color:     '#14151f',
    map:       createDeckTexture(),
    metalness: 0.22,
    roughness: 0.86,
  })
  const floor         = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), deckMat)
  floor.rotation.x    = -Math.PI / 2
  floor.receiveShadow = true
  root.add(floor)

  // Territory is marked with LINES, not a tinted area.
  //
  // The chase camera rides 3.5 units off the deck, so anything painted flat on
  // the floor near your own base fills most of the frame — a 90-unit tint band
  // turned the whole view into a maroon wash and made the arena unreadable.
  // Two thin markers per side say the same thing and cost no screen.
  for (const team of BATTLE_TEAMS) {
    const sign = team === 'red' ? -1 : 1
    for (const [ z, width, alpha ] of [
      [ sign * 205, 2.4, 0.45 ], [ sign * 268, 1.2, 0.28 ],
    ] as Array<[number, number, number]>) {
      const line = new THREE.Mesh(
        new THREE.PlaneGeometry(HALF * 2, width),
        new THREE.MeshBasicMaterial({
          color:       TEAM_COLORS[team],
          transparent: true,
          opacity:     alpha,
          depthWrite:  false,
          toneMapped:  false,
        })
      )
      line.rotation.x = -Math.PI / 2
      line.position.set(0, 0.03, z)
      root.add(line)
    }
  }

  // 10-unit cells. At 120 divisions the lines aliased into moiré bands the
  // moment the camera got low, which is where the camera always is.
  const grid      = new THREE.GridHelper(HALF * 2, 60, '#2f3550', '#1c1f30')
  grid.position.y = 0.02
  root.add(grid)

  buildPlateauMeshes(root, plateaus)
  buildPerimeter(root)

  // Base pylons holding each team's objective.
  const padGeometry = new THREE.CylinderGeometry(16, 18, 1.2, 32)
  const padMaterial = new THREE.MeshStandardMaterial({ color: '#1a1c2a', metalness: 0.5, roughness: 0.5 })
  const pads        = new THREE.InstancedMesh(padGeometry, padMaterial, BATTLE_TEAMS.length)
  const padMatrix   = new THREE.Matrix4()
  BATTLE_TEAMS.forEach((team, teamIndex) => {
    const { position } = bases[team]
    const color        = TEAM_COLORS[team]

    padMatrix.makeTranslation(position[0], 0.6, position[2])
    pads.setMatrixAt(teamIndex, padMatrix)

    const ringMat   = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, side: THREE.DoubleSide })
    const ring      = new THREE.Mesh(new THREE.RingGeometry(15.2, 17.6, 48), ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.set(position[0], 1.25, position[2])
    root.add(ring)

    const pylon = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.6, 0.9, 12, 12),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 }),
      2
    )
    const offsets = [ -13, 13 ]
    offsets.forEach((dx, i) => {
      padMatrix.makeTranslation(position[0] + dx, 6, position[2])
      pylon.setMatrixAt(i, padMatrix)
    })
    pylon.instanceMatrix.needsUpdate = true
    pylon.castShadow                 = true
    root.add(pylon)
  })
  pads.instanceMatrix.needsUpdate = true
  pads.receiveShadow              = true
  root.add(pads)

  // Control zones are painted by the battle visual layer (per-ring materials
  // for ownership colours) — not static geometry here.

  root.add(new THREE.HemisphereLight('#93a6ff', '#141726', 0.95))
  for (const [ x, z ] of [[ 0, 0 ], [ 0, -200 ], [ 0, 200 ]] as Array<[number, number]>) {
    const light = new THREE.PointLight('#aab4ff', 260, 1400, 1.6)
    light.position.set(x, 120, z)
    root.add(light)
  }

  scene.fog = new THREE.Fog(FOG[0], FOG[1], FOG[2])

  finaliseStaticScene('apex basin arena', root)
  scene.add(root)

  return buildScenery(scene, rng, { half: HALF, wallIn: WALL_IN, sunAnchor: SUN_ANCHOR })
}

// One collider traversal fills all five batches, keeping rails and ramps on the
// exact same transforms; splitting it would duplicate the load-bearing maths.
// eslint-disable-next-line max-statements
function buildPlateauMeshes (scene: THREE.Object3D, plateaus: PlateauDef[]): void {
  const rockMat = new THREE.MeshStandardMaterial({ color: '#232636', metalness: 0.25, roughness: 0.85 })
  const deckMat = new THREE.MeshStandardMaterial({ color: '#2c3145', metalness: 0.3, roughness: 0.72 })
  const rampMat = new THREE.MeshStandardMaterial({ color: '#343a52', metalness: 0.35, roughness: 0.62 })
  const edgeMat = new THREE.MeshBasicMaterial({ color: NEUTRAL_COLOR, transparent: true, opacity: 0.42 })

  const bodies: THREE.Matrix4[] = []
  const caps: THREE.Matrix4[]   = []
  const edges: THREE.Matrix4[]  = []
  const ramps: THREE.Matrix4[]  = []
  const rails: THREE.Matrix4[]  = []
  const object                  = new THREE.Object3D()
  const rail                    = new THREE.Object3D()

  for (const p of plateaus) {
    const [ cx, cz ] = p.centre
    const [ hx, hz ] = p.half
    const h          = p.height

    object.position.set(cx, h / 2, cz)
    object.rotation.set(0, 0, 0)
    object.scale.set(hx * 2, h, hz * 2)
    object.updateMatrix()
    bodies.push(object.matrix.clone())

    // A thin cap in a lighter tone so the drivable surface reads from a
    // distance; polygon offset keeps it off the mesa's own top face.
    object.position.set(cx, h + 0.02, cz)
    object.rotation.set(-Math.PI / 2, 0, 0)
    object.scale.set(hx * 2 - 0.4, hz * 2 - 0.4, 1)
    object.updateMatrix()
    caps.push(object.matrix.clone())

    // Rim light strip: four bars tracing the top edge.
    for (const [ ox, oz, sx, sz ] of [
      [ 0, hz, hx * 2, 0.6 ], [ 0, -hz, hx * 2, 0.6 ],
      [ hx, 0, 0.6, hz * 2 ], [ -hx, 0, 0.6, hz * 2 ],
    ] as Array<[number, number, number, number]>) {
      object.position.set(cx + ox, h + 0.06, cz + oz)
      object.rotation.set(-Math.PI / 2, 0, 0)
      object.scale.set(sx, sz, 1)
      object.updateMatrix()
      edges.push(object.matrix.clone())
    }

    // The ramps reuse the collider maths, so the mesh cannot drift from the
    // surface the hover pads actually ride on.
    for (const collider of plateauColliders(p).slice(1)) {
      const [ ax, ay, az ] = collider.args
      object.position.set(...collider.position)
      object.rotation.set(...collider.rotation)
      object.scale.set(ax * 2, ay * 2, az * 2)
      object.updateMatrix()
      ramps.push(object.matrix.clone())
      object.scale.set(1, 1, 1)
      object.updateMatrix()

      // Lit rails down both edges of the running surface. A bare grey wedge is
      // invisible against a grey deck from more than a hundred units out, and
      // finding the way up is the whole point of a ramp.
      const alongZ = az > ax
      const length = (alongZ ? az : ax) * 2
      const across = alongZ ? ax : az
      for (const side of [ -1, 1 ]) {
        rail.position.set(alongZ ? side * (across - 0.7) : 0, ay + 0.05, alongZ ? 0 : side * (across - 0.7))
        rail.rotation.set(-Math.PI / 2, 0, 0)
        rail.scale.set(alongZ ? 0.9 : length, alongZ ? length : 0.9, 1)
        rail.updateMatrix()
        rails.push(new THREE.Matrix4().multiplyMatrices(object.matrix, rail.matrix))
      }
    }
  }

  const addInstances = (matrices: THREE.Matrix4[], geometry: THREE.BufferGeometry, material: THREE.Material, shadows = false) => {
    const mesh = new THREE.InstancedMesh(geometry, material, matrices.length)
    matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix))
    mesh.instanceMatrix.needsUpdate = true
    mesh.castShadow                 = mesh.receiveShadow = shadows
    scene.add(mesh)
  }
  addInstances(bodies, new THREE.BoxGeometry(), rockMat, true)
  addInstances(caps, new THREE.PlaneGeometry(), deckMat)
  addInstances(edges, new THREE.PlaneGeometry(), edgeMat)
  addInstances(ramps, new THREE.BoxGeometry(), rampMat, true)
  addInstances(rails, new THREE.PlaneGeometry(), edgeMat)
}

/** Cliff face + a deterministic skyline of towers, so the boundary reads as a place. */
function buildPerimeter (scene: THREE.Object3D): void {
  const cliffMat = new THREE.MeshStandardMaterial({ color: '#191c28', metalness: 0.2, roughness: 0.9 })
  const wallH    = WALL_H * 2
  const inner    = HALF - WALL_IN

  const walls = [
    [ 0, inner, HALF, WALL_IN ], [ 0, -inner, HALF, WALL_IN ],
    [ inner, 0, WALL_IN, HALF ], [ -inner, 0, WALL_IN, HALF ],
  ] as Array<[number, number, number, number]>
  const wallMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cliffMat, walls.length)
  const matrix   = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const scale    = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  walls.forEach(([ x, z, w, d ], i) => wallMesh.setMatrixAt(i,
                                                            matrix.compose(position.set(x, WALL_H, z), rotation, scale.set(w * 2, wallH, d * 2))))
  wallMesh.instanceMatrix.needsUpdate = true
  wallMesh.castShadow                 = wallMesh.receiveShadow = true
  scene.add(wallMesh)

  // Warning stripe along the inner face, at windscreen height.
  const stripeMat = new THREE.MeshBasicMaterial({ color: '#f0b429', transparent: true, opacity: 0.3, side: THREE.DoubleSide })
  const stripes   = [
    [ 0, inner - WALL_IN - 0.1, 0, HALF ], [ 0, -(inner - WALL_IN - 0.1), 0, HALF ],
    [ inner - WALL_IN - 0.1, 0, Math.PI / 2, HALF ], [ -(inner - WALL_IN - 0.1), 0, Math.PI / 2, HALF ],
  ] as Array<[number, number, number, number]>
  const stripeMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), stripeMat, stripes.length)
  stripes.forEach(([ x, z, rot, len ], i) => {
    rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot)
    stripeMesh.setMatrixAt(i, matrix.compose(position.set(x, 5, z), rotation, scale.set(len * 2, 2.2, 1)))
  })
  stripeMesh.instanceMatrix.needsUpdate = true
  scene.add(stripeMesh)
}
