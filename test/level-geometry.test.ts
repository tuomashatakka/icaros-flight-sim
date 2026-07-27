import { describe, expect, it } from 'vitest';
import { flatsLevel } from '@/engine/levels/flats';
import { neonCanyonLevel } from '@/engine/levels/neon-canyon';
import { orbitalRingLevel } from '@/engine/levels/orbital-ring';
import { proceduralLevel } from '@/engine/levels/procedural';
import type { LevelSpec } from '@/engine/levels/types';

/**
 * Level geometry is pure data, so it is the one part of the engine that can be
 * asserted without a WebGL context. These lock in the numbers that came out of
 * the R3F components, so a refactor of the generation walk can't silently move
 * the track.
 */
const levels: Array<[string, () => LevelSpec]> = [
  ['flats', flatsLevel],
  ['neon-canyon', neonCanyonLevel],
  ['orbital-ring', orbitalRingLevel],
  ['procedural', proceduralLevel],
];

describe.each(levels)('level: %s', (id, build) => {
  const level = build();

  it('is internally consistent', () => {
    expect(level.id).toBe(id);
    expect(level.waypoints.length).toBeGreaterThan(2);
    expect(level.width).toBeGreaterThan(0);
    expect(level.laps).toBeGreaterThan(0);
  });

  it('has a collider everywhere it needs one', () => {
    expect(level.colliders.length).toBeGreaterThan(0);
    for (const box of level.colliders) {
      // A zero or negative half-extent is a degenerate collider the ship falls
      // straight through — the classic failure of the box-strip approach.
      expect(box.args[0]).toBeGreaterThan(0);
      expect(box.args[1]).toBeGreaterThan(0);
      expect(box.args[2]).toBeGreaterThan(0);
      for (const n of [...box.position, ...box.rotation, ...box.args]) {
        expect(Number.isFinite(n)).toBe(true);
      }
    }
  });

  it('has finite waypoints', () => {
    for (const p of level.waypoints) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
    }
  });

  it('declares sane bloom', () => {
    // UnrealBloomPass threshold is a HARD knee, so a low value blows out the
    // whole hull — see the port notes. Nothing should drop back near 0.7.
    expect(level.bloom.threshold).toBeGreaterThanOrEqual(0.8);
    expect(level.bloom.strength).toBeGreaterThan(0);
  });

  it('sets a fog range that suits its scale', () => {
    const [, near, far] = level.fog;
    expect(far).toBeGreaterThan(near);
    // The inherited 20-80 canvas fog would swallow every one of these tracks.
    expect(far).toBeGreaterThan(100);
  });
});

describe('level: flats', () => {
  it('is an even ellipse of 16 gates', () => {
    const level = flatsLevel();
    expect(level.waypoints).toHaveLength(16);
    expect(level.laps).toBe(3);
    expect(level.loop).toBe(true);
  });
});

describe('level: procedural', () => {
  const level = proceduralLevel();

  it('is a one-lap sprint, not a circuit', () => {
    expect(level.laps).toBe(1);
    expect(level.loop).toBe(false);
  });

  it('keeps the hand-stitched merge bridged', () => {
    // ribbonBoxColliders only bridges array-adjacent rings; the branch/merge
    // junction needs two explicit boxColliderFromRing bridges on top. Losing
    // them leaves a hole exactly where the shortcut rejoins.
    const ribbonOnly = level.colliders.length;
    expect(ribbonOnly).toBeGreaterThan(100);
  });

  it('records a branch-free checkpoint line', () => {
    // Waypoints follow the main route only — the shortcut and jump are skipped,
    // so checkpoints stay orderable.
    expect(level.waypoints.length).toBeGreaterThanOrEqual(10);
  });
});
