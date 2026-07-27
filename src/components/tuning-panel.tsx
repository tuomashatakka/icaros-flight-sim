'use client';

import { useState } from 'react';
import { useTuningStore } from '@/hooks/use-tuning-store';
import { asSource, isDefaultTuning } from '@/lib/tuning';
import type { ShipTuning } from '@/engine/state';
import { cn } from '@/lib/utils';

/**
 * Live physics tuning panel — replaces `<Leva collapsed />`.
 *
 * Built on native range inputs rather than the `ui/` shadcn tree: those files
 * are scaffolded boilerplate whose Radix packages are not installed
 * (`@radix-ui/react-slider` among them), and the point of this phase is to
 * REMOVE dependencies. This matches the hangar panel's primitives instead.
 */

/** Ranges carried over verbatim from the Leva schema in `vehicle-scene.tsx`. */
const SPECS: Array<{
  key: keyof ShipTuning;
  label: string;
  min: number;
  max: number;
  step: number;
  hint: string;
}> = [
  {
    key: 'hoverHeight',
    label: 'hover height',
    min: 0.2,
    max: 1.6,
    step: 0.05,
    hint: 'suspension rest length — ride height above the track',
  },
  {
    key: 'suspensionStiffness',
    label: 'suspension',
    min: 5,
    max: 60,
    step: 1,
    hint: 'higher is firmer, with less bob',
  },
  { key: 'thrust', label: 'thrust', min: 200, max: 2500, step: 50, hint: 'engine force per wheel' },
  {
    key: 'sideGrip',
    label: 'side grip',
    min: 0.5,
    max: 6,
    step: 0.1,
    hint: 'lateral carve — resists sliding out of turns',
  },
  {
    key: 'maxYawRate',
    label: 'yaw rate',
    min: 0.5,
    max: 5,
    step: 0.1,
    hint: 'peak turn rate on the ground (rad/s)',
  },
  {
    key: 'uprightStrength',
    label: 'upright',
    min: 1,
    max: 20,
    step: 0.5,
    hint: 'pull toward the surface normal — at 0 the ship flips under thrust',
  },
  { key: 'maxBank', label: 'bank', min: 0, max: 1.2, step: 0.05, hint: 'cosmetic lean into a turn' },
];

export function TuningPanel() {
  const tuning = useTuningStore((s) => s.tuning);
  const open = useTuningStore((s) => s.open);
  const setOpen = useTuningStore((s) => s.setOpen);
  const set = useTuningStore((s) => s.set);
  const reset = useTuningStore((s) => s.reset);
  const [copied, setCopied] = useState(false);

  const dirty = !isDefaultTuning(tuning);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asSource(tuning));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard is permission-gated and unavailable over plain http on some
      // hosts. Failing silently would look like a dead button, so fall back to
      // the console — the numbers still get out.
      console.info(asSource(tuning));
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute right-8 top-72 z-40 rounded-lg border border-white/20 bg-black/60 px-3 py-1.5 font-mono text-xs text-white/70 transition-colors hover:text-accent"
      >
        tuning{dirty ? ' ·' : ''}
      </button>
    );
  }

  return (
    <div className="absolute right-8 top-72 z-40 w-72 rounded-lg border border-white/20 bg-black/70 p-4 font-mono text-white backdrop-blur-sm">
      <header className="mb-3 flex items-center justify-between">
        <span className="text-xs uppercase tracking-widest text-white/50">ship physics</span>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-white/50 transition-colors hover:text-accent"
          aria-label="Collapse tuning panel"
        >
          ✕
        </button>
      </header>

      <div className="space-y-3">
        {SPECS.map((spec) => (
          <label key={spec.key} className="block" title={spec.hint}>
            <span className="flex items-baseline justify-between text-[11px] text-white/60">
              <span>{spec.label}</span>
              <span
                className={cn(
                  'tabular-nums',
                  tuning[spec.key] === undefined ? 'text-white/40' : 'text-white/90'
                )}
              >
                {tuning[spec.key]}
              </span>
            </span>
            <input
              type="range"
              min={spec.min}
              max={spec.max}
              step={spec.step}
              value={tuning[spec.key]}
              onChange={(e) => set(spec.key, parseFloat(e.target.value))}
              className="w-full accent-accent"
            />
          </label>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={copy}
          className="flex-1 rounded border border-white/20 px-2 py-1.5 text-[11px] transition-colors hover:border-accent hover:text-accent"
        >
          {copied ? 'copied ✓' : 'copy as TS'}
        </button>
        <button
          onClick={reset}
          disabled={!dirty}
          className="flex-1 rounded border border-white/20 px-2 py-1.5 text-[11px] transition-colors hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-white/20 disabled:hover:text-white"
        >
          reset
        </button>
      </div>

      <p className="mt-2 text-[10px] leading-snug text-white/40">
        Applies live and persists across reloads. Copy emits only the values that moved.
      </p>
    </div>
  );
}
