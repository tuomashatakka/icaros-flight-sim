/**
 * The hull drawn for a ship the client does NOT simulate.
 *
 * Every remote is an interpolated transform with no physics: their motion is
 * the server's to decide, and stepping it locally would only produce a second,
 * disagreeing answer. So this is deliberately geometry and nothing else — no
 * body, no controller, no state.
 *
 * Shared by race and battle. Battle tints by team, race by grid position; the
 * shape is the same because the collider is.
 *
 * The shape being the same is also why nothing here is built per ship. Every
 * hull used to allocate its own seven geometries and seven materials, none of
 * which was ever disposed — `dropOpponent` unparents a hull, it does not free
 * it — so a full battle grid built eighty-odd of each and leaked all of them on
 * every rejoin. The geometry is fixed and the tint set is bounded (six grid
 * positions, two teams), so both are shared and the per-ship cost is seven
 * `Mesh` wrappers over them.
 */

import * as THREE from 'three'


/**
 * One set of geometries for every hull ever drawn.
 *
 * Module scope rather than lazily built: these are plain typed arrays, they
 * need no WebGL context to construct, and a scene that draws no remotes pays
 * for them once at import rather than on the frame the first opponent joins.
 */
const GEOMETRY = {
  chassis: new THREE.BoxGeometry(1.7, 0.55, 2.6),
  nose:    new THREE.ConeGeometry(0.55, 1.3, 6),
  canopy:  new THREE.SphereGeometry(0.4, 12, 8),
  fin:     new THREE.BoxGeometry(0.45, 0.18, 1.7),
  skirt:   new THREE.BoxGeometry(1.25, 0.1, 2.2),
  glow:    new THREE.PlaneGeometry(1.1, 0.3),
}

/** Tint-independent, so there is exactly one of each for the whole session. */
const CANOPY_MATERIAL = new THREE.MeshStandardMaterial({ color: '#0d0f18', metalness: 0.9, roughness: 0.12 })
const SKIRT_MATERIAL  = new THREE.MeshStandardMaterial({ color: '#05060a', metalness: 0.2, roughness: 0.8 })

type TintedMaterials = {
  chassis: THREE.Material;
  nose:    THREE.Material;
  fin:     THREE.Material;
  glow:    THREE.Material;
}

/** Keyed by the resolved hex, so two callers naming one colour differently still share. */
const tinted = new Map<number, TintedMaterials>()

function materialsFor (tint: THREE.ColorRepresentation): TintedMaterials {
  const color    = new THREE.Color(tint)
  const existing = tinted.get(color.getHex())
  if (existing)
    return existing

  const made: TintedMaterials = {
    chassis: new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.4), metalness: 0.6, roughness: 0.38 }),
    nose:    new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.75), metalness: 0.45, roughness: 0.4 }),
    fin:     new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, metalness: 0.5, roughness: 0.4 }),
    glow:    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, toneMapped: false }),
  }

  tinted.set(color.getHex(), made)
  return made
}

/** Position, then parent. Keeps the body below one shape per statement. */
function part (
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: readonly [number, number, number]
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(position[0], position[1], position[2])
  mesh.castShadow    = true
  mesh.receiveShadow = true
  return mesh
}

export function buildRemoteHull (tint: THREE.ColorRepresentation): THREE.Group {
  const material = materialsFor(tint)
  const root     = new THREE.Group()

  // Sized to the actual collider (1.0 × 0.225 × 2.65 half-extents) rather than
  // eyeballed: a hull visibly wider than the body it wraps makes every near
  // miss look like a hit.
  root.add(part(GEOMETRY.chassis, material.chassis, [ 0, 0.5, 0 ]))

  const nose      = part(GEOMETRY.nose, material.nose, [ 0, 0.5, 1.7 ])
  nose.rotation.x = Math.PI / 2
  root.add(nose)

  const canopy = part(GEOMETRY.canopy, CANOPY_MATERIAL, [ 0, 0.78, 0.2 ])
  canopy.scale.set(0.85, 0.7, 1.2)
  root.add(canopy)

  for (const x of [ -1.05, 1.05 ])
    root.add(part(GEOMETRY.fin, material.fin, [ x, 0.4, -0.3 ]))

  root.add(part(GEOMETRY.skirt, SKIRT_MATERIAL, [ 0, 0.08, 0 ]))
  root.add(part(GEOMETRY.glow, material.glow, [ 0, 0.45, -1.35 ]))

  return root
}
