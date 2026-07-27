'use client'

import { useState } from 'react'
import { useTuningStore } from '@/hooks/use-tuning-store'
import { asSource, isDefaultTuning } from '@/lib/tuning'
import type { ShipTuning } from '@/engine/state'
import styles from './tuning-panel.module.css'

/**
 * Live physics tuning panel — replaces `<Leva collapsed />`.
 *
 * Native range inputs styled in `globals.css`, laid out with a CSS module.
 * There is no component library behind any of it.
 */

/** Ranges carried over verbatim from the Leva schema in `vehicle-scene.tsx`. */
const SPECS: Array<{
  key:   keyof ShipTuning;
  label: string;
  min:   number;
  max:   number;
  step:  number;
  hint:  string;
}> = [
  {
    key:   'hoverHeight',
    label: 'hover height',
    min:   0.2,
    max:   1.6,
    step:  0.05,
    hint:  'suspension rest length — ride height above the track',
  },
  {
    key:   'suspensionStiffness',
    label: 'suspension',
    min:   5,
    max:   60,
    step:  1,
    hint:  'higher is firmer, with less bob',
  },
  { key: 'thrust', label: 'thrust', min: 200, max: 2500, step: 50, hint: 'engine force per wheel' },
  {
    key:   'sideGrip',
    label: 'side grip',
    min:   0.5,
    max:   6,
    step:  0.1,
    hint:  'lateral carve — resists sliding out of turns',
  },
  {
    key:   'maxYawRate',
    label: 'yaw rate',
    min:   0.5,
    max:   5,
    step:  0.1,
    hint:  'peak turn rate on the ground (rad/s)',
  },
  {
    key:   'uprightStrength',
    label: 'upright',
    min:   1,
    max:   20,
    step:  0.5,
    hint:  'pull toward the surface normal — at 0 the ship flips under thrust',
  },
  { key: 'maxBank', label: 'bank', min: 0, max: 1.2, step: 0.05, hint: 'cosmetic lean into a turn' },
]

export function TuningPanel () {
  const tuning                = useTuningStore(s => s.tuning)
  const open                  = useTuningStore(s => s.open)
  const setOpen               = useTuningStore(s => s.setOpen)
  const set                   = useTuningStore(s => s.set)
  const reset                 = useTuningStore(s => s.reset)
  const [ copied, setCopied ] = useState(false)

  const dirty = !isDefaultTuning(tuning)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asSource(tuning))
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    }
    catch {
      // Clipboard is permission-gated and unavailable over plain http on some
      // hosts. Failing silently would look like a dead button, so fall back to
      // the console — the numbers still get out.
      console.info(asSource(tuning))
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    }
  }

  if (!open)
    return <button
      className={ styles.toggle }
      onClick={ () => setOpen(true) }>
      tuning{dirty ? ' ·' : ''}
    </button>

  return <div className={ styles.panel }>
    <header className={ styles.header }>
      <span className={ styles.title }>ship physics</span>

      <button
        className={ styles.close }
        aria-label="Collapse tuning panel"
        onClick={ () => setOpen(false) }>
        ✕
      </button>
    </header>

    <div className={ styles.knobs }>
      {SPECS.map(spec =>
        <label key={ spec.key } className={ styles.knob } title={ spec.hint }>
          <span className={ styles.knobHead }>
            <span>{spec.label}</span>
            <span className={ styles.knobValue }>{tuning[spec.key]}</span>
          </span>

          <input
            type="range"
            min={ spec.min }
            max={ spec.max }
            step={ spec.step }
            value={ tuning[spec.key] }
            onChange={ e => set(spec.key, parseFloat(e.target.value)) } />
        </label>
      )}
    </div>

    <div className={ styles.actions }>
      <button
        onClick={ copy }
        className={ styles.action }>
        {copied ? 'copied ✓' : 'copy as TS'}
      </button>

      <button
        onClick={ reset }
        disabled={ !dirty }
        className={ styles.action }>
        reset
      </button>
    </div>

    <p className={ styles.note }>
      Applies live and persists across reloads. Copy emits only the values that moved.
    </p>
  </div>
}
