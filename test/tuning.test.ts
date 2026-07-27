import { describe, expect, it } from 'vitest';
import { asSource, isDefaultTuning } from '@/lib/tuning';
import { DEFAULT_TUNING } from '@/engine/state';

/**
 * The copy-as-TypeScript output is the whole reason this panel exists rather
 * than Leva: it is how a tuning session leaves the browser and reaches
 * `vehicleConfig`. Worth pinning, because a regression here is silent — the
 * button still lights up "copied ✓" while emitting the wrong block.
 */
describe('asSource', () => {
  it('emits nothing to paste when the tuning is untouched', () => {
    expect(asSource(DEFAULT_TUNING)).toMatch(/nothing to copy/);
    expect(isDefaultTuning(DEFAULT_TUNING)).toBe(true);
  });

  it('emits only the fields that moved', () => {
    const tuning = { ...DEFAULT_TUNING, thrust: 1800, maxBank: 0.9 };
    const source = asSource(tuning);

    expect(source).toContain('thrust: 1800,');
    expect(source).toContain('maxBank: 0.9,');
    // A full dump invites pasting seven lines over one changed value and
    // reverting everyone else's edits to the other six.
    expect(source).not.toContain('sideGrip');
    expect(source).not.toContain('hoverHeight');
    expect(isDefaultTuning(tuning)).toBe(false);
  });

  it('names the file the block belongs in', () => {
    expect(asSource({ ...DEFAULT_TUNING, sideGrip: 4.5 })).toContain('src/lib/utils.ts');
  });
});
