import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { buildHullRig, extractHullProfile, collectHullParts } from 'Σship/hull-profile'
import { applyHullDeform } from 'Σship/hull-deform'
import { createGeneratedIcarasShip } from 'Σship/icaras-generated'
import { HULL_DEFAULTS, HULL_SLIDERS, hullShapeKey, hullShapeOf, isFactoryShape } from 'Ȼship/hull-shape'
import type { HullShape } from 'Ȼship/hull-shape'


/**
 * The parametric hull is pure geometry — no canvas, no GL — so the whole thing
 * is testable in node even though nothing else in the ship pipeline is.
 *
 * The properties pinned here are the ones that make ONE deformer safe on nine
 * hulls it was never tuned against: that factory values are the identity, that
 * landmarks come from the vertex cloud rather than a per-ship table, and that
 * dragging a slider out and back lands on the source mesh rather than drifting.
 */

/** A crude delta-wing: nose at +z, wide thin wings aft, two pods at the -z tail. */
type TestHullReturnType = { root: THREE.Object3D; frame: THREE.Object3D }

function testHull (): TestHullReturnType {
  const frame = new THREE.Group()
  const root  = new THREE.Group()
  frame.add(root)

  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 4, 4, 4, 12))
  root.add(fuselage)

  const wings      = new THREE.Mesh(new THREE.BoxGeometry(6, 0.1, 1.2, 12, 1, 4))
  wings.position.z = -1.4
  root.add(wings)

  for (const x of [ -1, 1 ]) {
    const pod      = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.2, 8))
    pod.rotation.x = Math.PI / 2
    pod.position.set(x, 0, -1.8)
    root.add(pod)
  }

  frame.updateMatrixWorld(true)
  return { root, frame }
}

const boundsOf = (root: THREE.Object3D) => {
  root.updateMatrixWorld(true)
  return new THREE.Box3().setFromObject(root)
}

const shape = (patch: Partial<HullShape>): HullShape => ({ ...HULL_DEFAULTS, ...patch })

describe('extractHullProfile', () => {
  it('measures the hull rather than reading a per-ship table', () => {
    const { root, frame } = testHull()
    const profile         = extractHullProfile(collectHullParts(root, frame))

    expect(profile.vertexCount).toBeGreaterThan(0)
    // Half-beam is the |x| quantile, so the 6-unit wing span dominates.
    expect(profile.halfBeam).toBeCloseTo(3, 1)
    // The pods hang aft of the fuselage, so the span is 4.4 not 4.
    expect(profile.halfLength).toBeCloseTo(2.2, 1)
    // Wing blend starts inboard of the tip and outboard of the fuselage.
    expect(profile.wingThreshold).toBeGreaterThan(0.3)
    expect(profile.wingThreshold).toBeLessThan(profile.halfBeam)
  })

  it('puts the widest station on the wings, aft of centre', () => {
    const { root, frame } = testHull()
    const profile         = extractHullProfile(collectHullParts(root, frame))

    // Stations run +1 nose … -1 tail; the wings sit at z = -1.4.
    expect(profile.chineStation).toBeLessThan(0)
  })
})

describe('applyHullDeform', () => {
  it('is the identity at factory values, authored normals included', () => {
    const { root, frame } = testHull()
    const rig             = buildHullRig(root, frame)
    const mesh            = root.children[0] as THREE.Mesh
    const before          = Float32Array.from(mesh.geometry.getAttribute('position').array as Float32Array)
    const normalsBefore   = Float32Array.from(mesh.geometry.getAttribute('normal').array as Float32Array)

    applyHullDeform(rig, HULL_DEFAULTS)

    expect(Array.from(mesh.geometry.getAttribute('position').array as Float32Array)).toEqual(Array.from(before))
    expect(Array.from(mesh.geometry.getAttribute('normal').array as Float32Array)).toEqual(Array.from(normalsBefore))
  })

  it('returns to the source mesh after a round trip through a deformed shape', () => {
    const { root, frame } = testHull()
    const rig             = buildHullRig(root, frame)
    const mesh            = root.children[0] as THREE.Mesh
    const before          = Float32Array.from(mesh.geometry.getAttribute('position').array as Float32Array)

    applyHullDeform(rig, shape({ wingSpan: 1.8, hullTwist: 22, canopyRise: 2 }))
    applyHullDeform(rig, HULL_DEFAULTS)

    expect(Array.from(mesh.geometry.getAttribute('position').array as Float32Array)).toEqual(Array.from(before))
  })

  it('is order-independent: the same values give the same mesh whatever came before', () => {
    const target = shape({ bodyWidth: 1.3, noseSharp: 1.5, keelDepth: 1.7 })

    const a = testHull()
    applyHullDeform(buildHullRig(a.root, a.frame), target)

    const b   = testHull()
    const rig = buildHullRig(b.root, b.frame)
    applyHullDeform(rig, shape({ bodyLength: 0.6, spineArch: 0.9 }))
    applyHullDeform(rig, target)

    const read = (o: THREE.Object3D) => Array.from((o.children[0] as THREE.Mesh).geometry.getAttribute('position').array as Float32Array)
    for (const [ i, value ] of read(a.root).entries())
      expect(read(b.root)[i]).toBeCloseTo(value, 5)
  })

  it('widens the hull for beam and stretches it for length', () => {
    const { root, frame } = testHull()
    const rig             = buildHullRig(root, frame)
    const base            = boundsOf(root).getSize(new THREE.Vector3())

    applyHullDeform(rig, shape({ bodyWidth: 1.5 }))
    expect(boundsOf(root).getSize(new THREE.Vector3()).x).toBeGreaterThan(base.x * 1.4)

    applyHullDeform(rig, shape({ bodyLength: 1.5 }))
    expect(boundsOf(root).getSize(new THREE.Vector3()).z).toBeGreaterThan(base.z * 1.4)
  })

  it('reaches the wings without moving the fuselage', () => {
    const { root, frame } = testHull()
    const rig             = buildHullRig(root, frame)
    const fuselage        = root.children[0] as THREE.Mesh
    const wings           = root.children[1] as THREE.Mesh
    const fuselageBefore  = Float32Array.from(fuselage.geometry.getAttribute('position').array as Float32Array)
    const wingsBefore     = new THREE.Box3().setFromBufferAttribute(wings.geometry.getAttribute('position') as THREE.BufferAttribute)

    applyHullDeform(rig, shape({ wingSpan: 1.8 }))

    const wingsAfter = new THREE.Box3().setFromBufferAttribute(wings.geometry.getAttribute('position') as THREE.BufferAttribute)
    expect(wingsAfter.max.x).toBeGreaterThan(wingsBefore.max.x + 0.5)

    // The fuselage is inboard of `wingThreshold`, so the wing mask never
    // reaches it — this is the property that keeps the wing sliders from
    // simply scaling the whole ship.
    const fuselageAfter = fuselage.geometry.getAttribute('position').array as Float32Array
    const drift         = Math.max(...Array.from(fuselageBefore, (v, i) => Math.abs(v - fuselageAfter[i])))
    expect(drift).toBeLessThan(0.05)
  })

  it('deforms child meshes parented at an offset, without counter-scaling', () => {
    const { root, frame } = testHull()
    const rig             = buildHullRig(root, frame)
    const pod             = root.children[2] as THREE.Mesh

    // Pods sit at z = -1.8, well inside the engine-bay slab.
    const before = new THREE.Box3().setFromObject(pod)
      .clone()
    applyHullDeform(rig, shape({ podRadius: 2 }))
    root.updateMatrixWorld(true)

    const after = new THREE.Box3().setFromObject(pod)

    expect(after.getSize(new THREE.Vector3()).y).toBeGreaterThan(before.getSize(new THREE.Vector3()).y)
  })

  it('tolerates a hull with no geometry rather than emitting NaN', () => {
    const frame = new THREE.Group()
    const root  = new THREE.Group()
    frame.add(root)

    const rig = buildHullRig(root, frame)
    expect(rig.profile.vertexCount).toBe(0)
    expect(() => applyHullDeform(rig, shape({ bodyWidth: 2 }))).not.toThrow()
  })
})

describe('the shape table', () => {
  it('exposes at least ten independent parameters', () => {
    expect(HULL_SLIDERS.length).toBeGreaterThanOrEqual(10)
  })

  it('has one slider per field, and every default inside its own range', () => {
    expect(HULL_SLIDERS.map(s => s.key).sort()).toEqual(Object.keys(HULL_DEFAULTS).sort())

    for (const slider of HULL_SLIDERS) {
      expect(slider.min).toBeLessThan(slider.max)
      expect(HULL_DEFAULTS[slider.key]).toBeGreaterThanOrEqual(slider.min)
      expect(HULL_DEFAULTS[slider.key]).toBeLessThanOrEqual(slider.max)
      // The randomiser must stay reachable by hand, or "randomize" produces a
      // silhouette the sliders cannot then be nudged back through.
      expect(slider.random[0]).toBeGreaterThanOrEqual(slider.min)
      expect(slider.random[1]).toBeLessThanOrEqual(slider.max)
    }
  })

  it('fills gaps from factory and detects the factory silhouette', () => {
    expect(isFactoryShape(hullShapeOf({}))).toBe(true)
    expect(isFactoryShape(hullShapeOf({ bodyWidth: Number.NaN }))).toBe(true)
    expect(isFactoryShape(hullShapeOf({ wingSweep: 12 }))).toBe(false)
    expect(hullShapeKey(hullShapeOf({}))).toBe(hullShapeKey(HULL_DEFAULTS))
  })

  it('moves every parameter somewhere, so none of the fifteen is inert', () => {
    // Measured over the WHOLE hull, not one mesh: the wing sliders are supposed
    // to leave the fuselage alone, and a per-mesh assertion would demand the
    // opposite of the masking this design is built on.
    const snapshot = (root: THREE.Object3D): number[] => {
      const out: number[] = []
      root.traverse(child => {
        const mesh = child as THREE.Mesh
        if (mesh.isMesh)
          out.push(...Array.from(mesh.geometry.getAttribute('position').array as Float32Array))
      })
      return out
    }

    for (const slider of HULL_SLIDERS) {
      const { root, frame } = testHull()
      const rig             = buildHullRig(root, frame)
      const before          = snapshot(root)

      // Push toward whichever end of the range is further from factory.
      const value = Math.abs(slider.max - HULL_DEFAULTS[slider.key]) > Math.abs(HULL_DEFAULTS[slider.key] - slider.min)
        ? slider.max
        : slider.min
      applyHullDeform(rig, shape({ [slider.key]: value }))

      const after = snapshot(root)
      const moved = Math.max(...before.map((v, i) => Math.abs(v - after[i])))
      expect(moved, `${slider.key} moved nothing`).toBeGreaterThan(1e-3)
    }
  })
})

/**
 * The synthetic hull above is a controlled case. This one is the real thing:
 * `createGeneratedIcarasShip` rebuilds the shipped Icaras from its extracted
 * part table — five meshes, four of them parented at an offset — and returns
 * untextured under node, because `loadIcarasTextures` short-circuits with no
 * DOM. So the production mesh, and the child-offset case that used to need a
 * counter-scale, are both covered without a browser.
 */
describe('the shipped Icaras', () => {
  const fitted = () => {
    const frame = new THREE.Group()
    const model = createGeneratedIcarasShip()
    frame.add(model)
    frame.updateMatrixWorld(true)
    return { frame, model }
  }

  it('scans into a profile with real landmarks', () => {
    const { frame, model } = fitted()
    const rig              = buildHullRig(model, frame)

    expect(rig.parts).toHaveLength(5)
    expect(rig.profile.vertexCount).toBeGreaterThan(500)
    expect(rig.profile.halfBeam).toBeGreaterThan(0)
    expect(rig.profile.halfLength).toBeGreaterThan(rig.profile.halfBeam)
    expect(rig.profile.wingThreshold).toBeLessThan(rig.profile.halfBeam)
  })

  it('answers every parameter without producing a NaN vertex', () => {
    const { frame, model } = fitted()
    const rig              = buildHullRig(model, frame)
    const base             = boundsOf(model).getSize(new THREE.Vector3())

    for (const slider of HULL_SLIDERS)
      for (const value of [ slider.min, slider.max ]) {
        applyHullDeform(rig, shape({ [slider.key]: value }))

        for (const part of rig.parts) {
          const positions = part.mesh.geometry.getAttribute('position').array as Float32Array
          expect(positions.every(Number.isFinite), `${slider.key}=${value} produced a non-finite vertex`).toBe(true)
        }

        // Nothing may collapse the hull to a point or blow it up past 6x — both
        // are silhouettes a pilot cannot fly and neither has a visible cause.
        const size = boundsOf(model).getSize(new THREE.Vector3())
        for (const axis of [ 'x', 'y', 'z' ] as const) {
          expect(size[axis], `${slider.key}=${value} collapsed ${axis}`).toBeGreaterThan(base[axis] * 0.1)
          expect(size[axis], `${slider.key}=${value} exploded ${axis}`).toBeLessThan(base[axis] * 6)
        }
      }
  })

  it('restores the shipped silhouette exactly when every slider goes home', () => {
    const { frame, model } = fitted()
    const rig              = buildHullRig(model, frame)
    const before           = rig.parts.map(p => Float32Array.from(p.mesh.geometry.getAttribute('position').array as Float32Array))

    applyHullDeform(rig, shape({ bodyWidth: 1.7, wingSweep: 55, podLength: 2, hullTwist: -25 }))
    applyHullDeform(rig, HULL_DEFAULTS)

    rig.parts.forEach((part, i) => {
      expect(Array.from(part.mesh.geometry.getAttribute('position').array as Float32Array)).toEqual(Array.from(before[i]))
    })
  })
})
