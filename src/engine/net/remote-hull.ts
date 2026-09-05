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
 */

import * as THREE from 'three'


export function buildRemoteHull (tint: THREE.ColorRepresentation): THREE.Group {
  const color = new THREE.Color(tint)
  const root  = new THREE.Group()

  // Sized to the actual collider (1.0 × 0.225 × 2.65 half-extents) rather than
  // eyeballed: a hull visibly wider than the body it wraps makes every near
  // miss look like a hit.
  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.55, 2.6),
    new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.4), metalness: 0.6, roughness: 0.38 })
  )
  chassis.position.y = 0.5
  root.add(chassis)

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 1.3, 6),
    new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.75), metalness: 0.45, roughness: 0.4 })
  )
  nose.rotation.x = Math.PI / 2
  nose.position.set(0, 0.5, 1.7)
  root.add(nose)

  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 12, 8),
    new THREE.MeshStandardMaterial({ color: '#0d0f18', metalness: 0.9, roughness: 0.12 })
  )
  canopy.scale.set(0.85, 0.7, 1.2)
  canopy.position.set(0, 0.78, 0.2)
  root.add(canopy)

  for (const x of [ -1.05, 1.05 ]) {
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.18, 1.7),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, metalness: 0.5, roughness: 0.4 })
    )
    fin.position.set(x, 0.4, -0.3)
    root.add(fin)
  }

  const skirt = new THREE.Mesh(
    new THREE.BoxGeometry(1.25, 0.1, 2.2),
    new THREE.MeshStandardMaterial({ color: '#05060a', metalness: 0.2, roughness: 0.8 })
  )
  skirt.position.y = 0.08
  root.add(skirt)

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.3),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, toneMapped: false })
  )
  glow.position.set(0, 0.45, -1.35)
  root.add(glow)

  root.traverse(o => {
    o.castShadow    = true
    o.receiveShadow = true
  })
  return root
}
