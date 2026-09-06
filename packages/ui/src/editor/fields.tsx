'use client'

import type { ReactNode } from 'react'
import styles from './map-editor.module.css'


/**
 * The inspector's input vocabulary.
 *
 * Four primitives cover every field in the forge. The previous inspector wrote
 * each control out by hand, which is how it ended up with a slider labelled
 * "Track width" in metres next to one labelled "Left wall rounding" in degrees
 * that fed the same untyped `updatePoint(key, number)`.
 */

type NumberFieldProps = {
  label:    string;
  value:    number;
  min?:     number;
  max?:     number;
  step?:    number;
  unit?:    string;
  onChange: (value: number) => void;
}

/** A slider and its exact value, editable both ways. */
export function NumberField ({ label, value, min = 0, max = 100, step = 1, unit = '', onChange }: NumberFieldProps) {
  const commit = (raw: string) => {
    const parsed = Number(raw)
    if (Number.isFinite(parsed))
      onChange(Math.min(max, Math.max(min, parsed)))
  }

  return <label className={ styles.field }>
    <span>
      { label }
      <output>{ Number.isInteger(step) ? Math.round(value) : value.toFixed(2) }{ unit }</output>
    </span>

    <input type="range" min={ min } max={ max } step={ step } value={ value } onChange={ e => commit(e.target.value) } />
    <input type="number" min={ min } max={ max } step={ step } value={ value } onChange={ e => commit(e.target.value) } />
  </label>
}

type TextFieldProps = { label: string; value: string; onChange: (value: string) => void }

export function TextField ({ label, value, onChange }: TextFieldProps) {
  return <label className={ styles.field }>
    <span>{ label }</span>
    <input type="text" value={ value } onChange={ e => onChange(e.target.value) } />
  </label>
}

export function ColorField ({ label, value, onChange }: TextFieldProps) {
  return <label className={ styles.field }>
    <span>{ label }</span>

    <span className={ styles.colorRow }>
      <input type="color" value={ value } onChange={ e => onChange(e.target.value) } />
      <input type="text" value={ value } onChange={ e => onChange(e.target.value) } />
    </span>
  </label>
}

type ToggleFieldProps = { label: string; value: boolean; onChange: (value: boolean) => void }

export function ToggleField ({ label, value, onChange }: ToggleFieldProps) {
  return <label className={ styles.toggleField }>
    <input type="checkbox" checked={ value } onChange={ e => onChange(e.target.checked) } />
    <span>{ label }</span>
  </label>
}

type GroupProps = { title: string; children: ReactNode }

export function Group ({ title, children }: GroupProps) {
  return <fieldset className={ styles.group }>
    <legend>{ title }</legend>
    { children }
  </fieldset>
}

/** Read-only derived numbers — what the compiler produced from what you authored. */
type ReadoutProps = { rows: [string, string][] }

export function Readout ({ rows }: ReadoutProps) {
  return <dl className={ styles.readout }>
    { rows.map(([ term, value ]) => <div key={ term }>
      <dt>{ term }</dt>
      <dd>{ value }</dd>
    </div>) }
  </dl>
}
