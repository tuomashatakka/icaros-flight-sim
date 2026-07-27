import * as THREE from 'three'
import { createArcGeometry, createArcTicks } from './arc'
import { createHoloMaterial, HOLO } from './materials'
import type { HoloMaterial } from './materials'

/**
 * Anything the HUD builds returns its meshes AND the materials it created, so
 * the owner can tick their clocks, cross-fade them and dispose them without
 * traversing the graph every frame.
 */
export type HoloPart = {
  object:    THREE.Object3D;
  materials: HoloMaterial[];
  dispose(): void;
}

/**
 * A single mesh plus the material and geometry it owns.
 *
 * The material is handed back rather than read off the mesh so callers can drive
 * its uniforms and cross-fade it without a `traverse` every frame.
 */
export type HoloMesh = {
  mesh:     THREE.Mesh;
  material: HoloMaterial;
  dispose(): void;
}

/** A thin axis-aligned bar. `uv.x` runs along its length, so it fills like a gauge. */
export function createBar (
  length: number,
  thickness: number,
  options: Parameters<typeof createHoloMaterial>[0] = {}
): HoloMesh {
  const geometry = new THREE.PlaneGeometry(length, thickness)
  const material = createHoloMaterial(options)
  const mesh     = new THREE.Mesh(geometry, material)

  return {
    mesh,
    material,
    dispose () {
      geometry.dispose()
      material.dispose()
    },
  }
}

/**
 * The canopy: a bezel arc top and bottom, corner brackets, and a tick strip.
 *
 * This is the part that has to sell "you are sitting inside something". It is
 * built wider than the visible frustum on purpose so it reads as structure
 * running past the edges of the screen rather than as a floating widget.
 */
export function createCanopyFrame (): HoloPart {
  const group                     = new THREE.Group()
  const materials: HoloMaterial[] = []
  const disposers: (() => void)[] = []

  const add = (part: HoloMesh) => {
    materials.push(part.material)
    disposers.push(part.dispose)
    group.add(part.mesh)
    return part.mesh
  }

  // Upper and lower bezel — shallow arcs, curving away from the centre so the
  // canopy reads as a dome rather than a rectangle.
  for (const [ y, flip ] of [[ 0.60, 1 ], [ -0.58, -1 ]] as const) {
    const geometry = createArcGeometry(2.30, 2.34, Math.PI * 0.5 - 0.42, 0.84, 64)
    const material = createHoloMaterial({ color: HOLO.cyan, opacity: 0.85, gain: 0.85 })
    const mesh     = new THREE.Mesh(geometry, material)
    // The arc is authored around its own centre; push it out so only its crown
    // crosses the view.
    mesh.position.set(0, y - flip * 2.32, 0)
    mesh.scale.y = flip
    materials.push(material)
    disposers.push(() => {
      geometry.dispose()
      material.dispose()
    })
    group.add(mesh)
  }

  // Corner brackets — two bars each, the cheapest possible "targeting frame".
  const corners: [number, number, number, number][] = [
    [ -1.12, 0.50, 1, 1 ],
    [ 1.12, 0.50, -1, 1 ],
    [ -1.12, -0.48, 1, -1 ],
    [ 1.12, -0.48, -1, -1 ],
  ]

  for (const [ x, y, sx, sy ] of corners) {
    const horizontal = add(createBar(0.20, 0.007, { color: HOLO.cyan, opacity: 0.9, gain: 1.0 }))
    horizontal.position.set(x + sx * 0.10, y, 0)

    const vertical = add(createBar(0.12, 0.007, { color: HOLO.cyan, opacity: 0.9, gain: 1.0 }))
    vertical.position.set(x, y - sy * 0.06, 0)
    vertical.rotation.z = Math.PI / 2
  }

  // A yaw tick strip across the top — reads as a compass ribbon.
  //
  // Sat high and kept narrow on purpose: on a radius this large the ends of the
  // sweep drop fast (y falls with cos), and a wider strip curves straight down
  // into the lap/time readouts below it.
  const tickGeometry = createArcTicks(2.30, 0.045, Math.PI * 0.5 - 0.25, 0.50, 19, 0.0025)
  const tickMaterial = createHoloMaterial({ color: HOLO.cyan, opacity: 0.5, gain: 0.8 })
  const ticks        = new THREE.Mesh(tickGeometry, tickMaterial)
  ticks.position.set(0, 0.62 - 2.32, 0)
  materials.push(tickMaterial)
  disposers.push(() => {
    tickGeometry.dispose()
    tickMaterial.dispose()
  })
  group.add(ticks)

  return {
    object: group,
    materials,
    dispose () {
      for (const dispose of disposers)
        dispose()
    },
  }
}
