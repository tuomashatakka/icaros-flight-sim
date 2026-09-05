'use client'

import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { WEAPONS } from '@crash-velocity/battle/weapons'
import type { WeaponId } from '@crash-velocity/battle/weapons'


/**
 * Bolt-on cannon hardpoints.
 *
 * The shapes follow the Icaras Foundry prototype's cannon catalogue — a
 * distinct silhouette per weapon class so a loadout is readable from the
 * outside — but everything is authored in HULL-RELATIVE units here. The
 * prototype hard-coded metre sizes against one model; the game fits nine hulls
 * of wildly different authored scale to a common target size, so a fixed-size
 * barrel is a toothpick on one ship and a cannon on the next.
 *
 * Geometry is authored pointing +z, matching the ships' travel direction.
 */

/** All barrels are built against a unit hull and scaled by its measured length. */
const U = 1

function tube (rt: number, rb: number, h: number, seg = 14, open = false): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open)
  g.rotateX(Math.PI / 2)
  return g
}

function ring (r: number, t: number, seg = 18): THREE.BufferGeometry {
  return new THREE.TorusGeometry(r, t, 8, seg)
}

function slab (w: number, h: number, d: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d)
}

function at (g: THREE.BufferGeometry, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  g.translate(x, y, z)
  return g
}

function merged (parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const geometry = mergeGeometries(parts.map(g => g.index ? g.toNonIndexed() : g))
  for (const part of parts)
    part.dispose()
  geometry.computeVertexNormals()
  return geometry
}

/** Barrel body for one hardpoint, in unit-hull space. */
export function cannonGeometry (weapon: WeaponId): THREE.BufferGeometry {
  switch (weapon) {
    case 'lance':
      // A long, thin lens barrel with a focusing ring — reads as a beam weapon.
      return merged([
        tube(0.018 * U, 0.018 * U, 0.30 * U, 12),
        at(ring(0.036 * U, 0.009 * U, 16), 0, 0, 0.11 * U),
        at(ring(0.030 * U, 0.007 * U, 16), 0, 0, -0.05 * U),
      ])
    case 'rail':
      // Twin parallel rails with a gap: unmistakably a railgun from any angle.
      return merged([
        at(slab(0.014 * U, 0.036 * U, 0.34 * U), 0.030 * U, 0, 0),
        at(slab(0.014 * U, 0.036 * U, 0.34 * U), -0.030 * U, 0, 0),
        at(slab(0.030 * U, 0.014 * U, 0.10 * U), 0, 0, -0.13 * U),
      ])
    case 'hornet':
      // Single-tube launcher: a squat box with one big bore.
      return merged([
        slab(0.075 * U, 0.062 * U, 0.20 * U),
        at(tube(0.028 * U, 0.028 * U, 0.09 * U, 12, true), 0, 0, 0.12 * U),
      ])
    case 'swarm': {
      // Four-cell rack, so the count on the HUD matches the count on the hull.
      const cells: THREE.BufferGeometry[] = [ slab(0.095 * U, 0.085 * U, 0.17 * U) ]
      for (const dx of [ -0.024, 0.024 ])
        for (const dy of [ -0.021, 0.021 ])
          cells.push(at(tube(0.017 * U, 0.017 * U, 0.07 * U, 10, true), dx * U, dy * U, 0.10 * U))
      return merged(cells)
    }

    default: {
      // pulse — a triad of short barrels around the mount axis.
      const barrels: THREE.BufferGeometry[] = []
      for (let i = 0; i < 3; i++) {
        const a = i / 3 * Math.PI * 2 + 0.5
        barrels.push(at(tube(0.014 * U, 0.014 * U, 0.20 * U, 10), Math.cos(a) * 0.026 * U, Math.sin(a) * 0.026 * U, 0))
      }
      barrels.push(at(tube(0.052 * U, 0.044 * U, 0.05 * U, 14), 0, 0, -0.10 * U))
      return merged(barrels)
    }
  }
}

/** Where the muzzle glow sits, in unit-hull space, per weapon. */
function muzzleZ (weapon: WeaponId): number {
  switch (weapon) {
    case 'lance': return 0.16 * U
    case 'rail': return 0.18 * U
    case 'hornet': return 0.17 * U
    case 'swarm': return 0.15 * U
    default: return 0.12 * U
  }
}

export type Hardpoint = {
  position: THREE.Vector3;

  /**
   * The hull's LARGEST dimension at derivation time. Cannons scale off this.
   *
   * Not the depth, which is what an earlier version used: the loader fits every
   * hull so its largest dimension equals one target size, so keying off that
   * gives an identically-proportioned gun on all nine — whereas depth is the
   * SHORT axis on the wide delta hulls and produced a toothpick on those and a
   * cannon on the long ones.
   */
  unit: number;
}

/**
 * Two forward hardpoints derived from the hull's own bounding box.
 *
 * Deliberately box-based rather than a vertex scan (which is what the
 * afterburner does for nozzles): engines have to land on the actual pods or the
 * plume floats in space, whereas a cannon is a bolt-on and looks right anywhere
 * along the leading edge. A box is stable across all nine hulls and costs
 * nothing to recompute when the shape sliders move.
 *
 * @param spread - Multiplier on the hull's half-width. 0 collapses both mounts
 * onto the centreline; 1 puts them at the widest point.
 * @param frame  - Node whose local space the mounts are expressed in. Must be
 * the hull's PARENT: `object` carries the fit scale, and measuring in its own
 * space while placing into the parent's silently shrinks every offset.
 */
export function deriveHardpoints (
  object: THREE.Object3D,
  spread: number,
  frame: THREE.Object3D = object.parent ?? object
): Hardpoint[] {
  object.updateWorldMatrix(true, true)
  frame.updateWorldMatrix(true, false)

  const inverse = new THREE.Matrix4().copy(frame.matrixWorld)
    .invert()
  const box     = new THREE.Box3().setFromObject(object)
    .applyMatrix4(inverse)
  const size   = box.getSize(new THREE.Vector3())
  const centre = box.getCenter(new THREE.Vector3())

  // Guard a degenerate hull rather than emitting NaN mounts.
  const unit = Math.max(size.x, size.y, size.z, 1e-3)

  // Underslung and inboard of the wingtip: a pod hanging under the body reads
  // as attached even with a small gap, whereas one level with the hull and out
  // near the tip reads as floating beside the ship.
  const x = size.x * 0.22 * spread
  const y = box.min.y + size.y * 0.34
  const z = centre.z + size.z * 0.1

  return [ -1, 1 ].map(sign => ({
    position: new THREE.Vector3(centre.x + sign * x, y, z),
    unit,
  }))
}

export type Cannons = {
  group: THREE.Group;

  /** Rebuild the barrels for a weapon. Cheap enough to call on every slider change. */
  setWeapon(weapon: WeaponId): void;
  setMounts(points: Hardpoint[]): void;

  /** Barrel size multiplier, on top of the hull-derived unit. */
  setScale(scale: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** A pair of hardpoint barrels with muzzle glows, parented to the ship root. */
export function createCannons (): Cannons {
  const group = new THREE.Group()

  const bodyMat = new THREE.MeshStandardMaterial({
    color:     '#8b93ad',
    metalness: 0.85,
    roughness: 0.32,
  })
  // Small and dim on purpose: this is an additive, un-tone-mapped sphere going
  // through a bloom pass, so anything with real presence in the raw buffer
  // becomes a headlight that swallows the wing it is mounted under.
  const glowMat = new THREE.MeshBasicMaterial({
    color:       WEAPONS.pulse.color,
    transparent: true,
    opacity:     0.5,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    toneMapped:  false,
  })

  let weapon: WeaponId                      = 'pulse'
  let scale                                 = 1
  let mounts: Hardpoint[]                   = []
  let geometry: THREE.BufferGeometry | null = null

  const glowGeo = new THREE.SphereGeometry(0.013, 8, 6)

  function rebuild (): void {
    group.clear()
    geometry?.dispose()
    geometry = cannonGeometry(weapon)
    glowMat.color.set(WEAPONS[weapon].color)

    for (const mount of mounts) {
      const pod = new THREE.Group()
      pod.position.copy(mount.position)
      // One scale for the whole pod, so barrel and glow can never drift apart.
      pod.scale.setScalar(mount.unit * scale)

      const barrel      = new THREE.Mesh(geometry, bodyMat)
      barrel.castShadow = true
      pod.add(barrel)

      const glow      = new THREE.Mesh(glowGeo, glowMat)
      glow.position.z = muzzleZ(weapon)
      pod.add(glow)

      group.add(pod)
    }
  }

  return {
    group,

    setWeapon (next) {
      if (next === weapon)
        return
      weapon = next
      rebuild()
    },

    setMounts (points) {
      mounts = points
      rebuild()
    },

    setScale (next) {
      if (Math.abs(next - scale) < 1e-4)
        return
      scale = next
      for (const pod of group.children)
        pod.scale.setScalar((mounts[0]?.unit ?? 1) * scale)
    },

    setVisible (visible) {
      group.visible = visible
    },

    dispose () {
      group.clear()
      geometry?.dispose()
      glowGeo.dispose()
      bodyMat.dispose()
      glowMat.dispose()
    },
  }
}
