import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { deriveNozzles } from '@/engine/fx/afterburner';

/**
 * `deriveNozzles` is pure geometry — no canvas, no GL — so it is testable in
 * node even though the rest of the afterburner is not.
 *
 * These exist because the function shipped broken once: it measured vertices in
 * the hull's local space while comparing them against a WORLD-space bounding
 * box, so on any scaled hull (which is every hull — the loader fits them all to
 * a target size) no vertex ever fell inside the tail slab and every ship
 * silently collapsed to a single centred engine.
 */

/** A crude delta-wing hull: nose at +z, two engine pods at the -z tail. */
function testHull(): THREE.Object3D {
  const group = new THREE.Group();

  const fuselage = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 4));
  group.add(fuselage);

  // Wings are as far back as the pods, and much wider — the case that makes a
  // naive whole-hull width measurement plant the beams out on the wingtips.
  const wings = new THREE.Mesh(new THREE.BoxGeometry(6, 0.1, 1.2));
  wings.position.z = -1.4;
  group.add(wings);

  for (const x of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.2));
    pod.rotation.x = Math.PI / 2;
    pod.position.set(x, 0, -1.9);
    group.add(pod);
  }

  return group;
}

describe('deriveNozzles', () => {
  it('finds a symmetric pair at the tail', () => {
    const nozzles = deriveNozzles(testHull(), 0.55);

    expect(nozzles).toHaveLength(2);
    expect(nozzles[0].position.x).toBeCloseTo(-nozzles[1].position.x, 5);
    expect(nozzles[0].position.z).toBeCloseTo(nozzles[1].position.z, 5);
    // Tail end, not the nose.
    expect(nozzles[0].position.z).toBeLessThan(0);
    expect(nozzles[0].radius).toBeGreaterThan(0);
  });

  it('survives a scaled hull under a parent frame', () => {
    // Exactly the loader's hierarchy: root -> inner(scale) -> model.
    const root = new THREE.Group();
    const inner = new THREE.Group();
    inner.scale.setScalar(0.37);
    inner.add(testHull());
    root.add(inner);

    const scaled = deriveNozzles(inner, 0.55);
    const plain = deriveNozzles(testHull(), 0.55);

    expect(scaled).toHaveLength(2);
    // Results land in ROOT space, so they are the unscaled positions times the
    // fit scale — not the raw model-space numbers, and not a degenerate single.
    expect(scaled[1].position.x).toBeCloseTo(plain[1].position.x * 0.37, 4);
    expect(scaled[1].position.z).toBeCloseTo(plain[1].position.z * 0.37, 4);
  });

  it('reads pod separation off the tail slab, not the wingspan', () => {
    // Wingtips sit at x = ±3; the pods at x = ±1. A whole-hull measurement at
    // spread 1.0 would put the beams somewhere near the tips.
    const nozzles = deriveNozzles(testHull(), 1);
    expect(Math.abs(nozzles[1].position.x)).toBeLessThan(2);
  });

  it('scales spread monotonically from the centreline', () => {
    const narrow = deriveNozzles(testHull(), 0.2);
    const wide = deriveNozzles(testHull(), 0.9);

    expect(Math.abs(narrow[1].position.x)).toBeLessThan(Math.abs(wide[1].position.x));
    expect(deriveNozzles(testHull(), 0)[1].position.x).toBeCloseTo(0, 5);
  });

  it('prefers vertices from a material named Glow', () => {
    const group = testHull();

    // Two small emissive discs far outboard of the geometric pods, standing in
    // for the `Glow` groups the WipEout scans carry on their exhausts. If the
    // annotation is being honoured these win outright over the hull's shape.
    for (const x of [-2.4, 2.4]) {
      const nozzle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16),
        new THREE.MeshStandardMaterial({ name: 'Glow' })
      );
      nozzle.position.set(x, 0, -1.95);
      group.add(nozzle);
    }

    const [left, right] = deriveNozzles(group, 1);
    expect(Math.abs(left.position.x)).toBeGreaterThan(2);
    expect(Math.abs(right.position.x)).toBeGreaterThan(2);
  });

  it('falls back to one central engine on an empty hull', () => {
    const nozzles = deriveNozzles(new THREE.Group(), 0.55);
    expect(nozzles).toHaveLength(1);
    expect(nozzles[0].radius).toBeGreaterThan(0);
  });
});
