import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { createWreckField } from 'Σfx/wreck'
import { createSeededRng } from 'threejs-scene'


/**
 * The wreck is the ship, cut up.
 *
 * A bag of generic cubes would have been a tenth of the code and would not read
 * as the hull that just died, so these cover the two properties that make the
 * difference: every triangle survives the cut, and the pieces are separated by
 * where they were on the hull rather than at random.
 */
function hull (): THREE.Group {
  const group = new THREE.Group()
  const mesh  = new THREE.Mesh(
    new THREE.BoxGeometry(4, 1, 9, 4, 2, 6),
    new THREE.MeshStandardMaterial()
  )
  group.add(mesh)
  return group
}

const triangles = (object: THREE.Object3D): number => {
  let total = 0
  object.traverse(child => {
    const mesh = child as THREE.Mesh
    if (!mesh.isMesh)
      return
    const index = mesh.geometry.getIndex()
    total += (index ? index.count : mesh.geometry.getAttribute('position').count) / 3
  })
  return total
}

describe('wreck field', () => {
  it('cuts a hull into pieces that account for every triangle', () => {
    const field  = createWreckField(createSeededRng(1))
    const source = hull()

    field.burst(source, new THREE.Vector3())

    // The pieces are the field's children minus its two permanent fixtures —
    // the flash root and the spark cloud.
    const debris = field.group.children.filter(child => (child as THREE.Mesh).isMesh)
    expect(debris.length).toBeGreaterThan(1)
    expect(triangles(source)).toBe(debris.reduce((sum, piece) => sum + triangles(piece), 0))

    field.dispose()
  })

  it('separates the pieces spatially rather than at random', () => {
    const field = createWreckField(createSeededRng(2))
    field.burst(hull(), new THREE.Vector3())

    const debris = field.group.children.filter(child => (child as THREE.Mesh).isMesh) as THREE.Mesh[]
    const centres = debris.map(piece => {
      piece.geometry.computeBoundingSphere()
      return piece.geometry.boundingSphere!.center
    })

    // Four quadrants of a box hull: no two pieces share a centre, and they
    // straddle both axes the cut is taken on.
    expect(new Set(centres.map(c => `${Math.sign(c.x)}:${Math.sign(c.z)}`)).size).toBe(centres.length)
    expect(centres.some(c => c.x > 0)).toBe(true)
    expect(centres.some(c => c.x < 0)).toBe(true)

    field.dispose()
  })

  it('reuses a cut hull rather than slicing it every time it dies', () => {
    // A wreck mid-race must not be the frame that builds four vertex buffers.
    const field  = createWreckField(createSeededRng(3))
    const source = hull()

    field.prime(source)
    const first = (source.children[0] as THREE.Mesh).geometry

    field.burst(source, new THREE.Vector3())
    const before = field.group.children.length
    field.update(10)
    field.burst(source, new THREE.Vector3())

    expect(field.group.children.length).toBe(before)
    expect((source.children[0] as THREE.Mesh).geometry).toBe(first)

    field.dispose()
  })

  it('ages debris out and leaves only its fixtures behind', () => {
    const field = createWreckField(createSeededRng(4))
    const fixtures = field.group.children.length

    field.burst(hull(), new THREE.Vector3())
    expect(field.group.children.length).toBeGreaterThan(fixtures)

    // Well past the longest debris span.
    for (let i = 0; i < 400; i++)
      field.update(1 / 60)

    expect(field.group.children.length).toBe(fixtures)
    field.dispose()
  })
})
