'use client'

import Link from 'next/link'
import { useShipStore } from '@/hooks/use-ship-store'
import { useHangarView } from '@/hooks/use-hangar-view'
import type { HangarViewToggle } from '@/hooks/use-hangar-view'
import { PALETTES } from '@/lib/ship/materials'
import { SHIP_IDS, SHIP_PRESETS } from '@/lib/ship/registry'
import type { ShipConfig } from '@/lib/ship/registry'
import styles from './hangar-controls.module.css'
import { PropsWithChildren } from 'react'

/**
 * Labelled slider.
 *
 * The panel is ~a dozen of these; spelling each one out (as an earlier version
 * did) buried the two that actually differ in a wall of identical markup. Value
 * formatting is injectable because multipliers and bare 0..1 ratios want
 * different suffixes.
 */
type SliderProps = {
  label:    string;
  value:    number;
  min:      number;
  max:      number;
  step:     number;
  onChange: (value: number) => void;
  format?:  (value: number) => string;
}

function Slider ({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v: number) => v.toFixed(2),
}: SliderProps) {
  return <label className={ styles.field }>
    <span className={ styles.fieldHead }>
      <span>{ label }</span>
      <span className={ styles.fieldValue }>{ format(value) }</span>
    </span>

    <input
      type="range"
      min={ min }
      max={ max }
      step={ step }
      value={ value }
      onChange={ e => onChange(parseFloat(e.target.value)) } />
  </label>
}

type SwatchProps = {
  label:    string;
  value:    string;
  onChange: (value: string) => void;
}

function Swatch ({
  label,
  value,
  onChange,
}: SwatchProps) {
  return <div className={ styles.field }>
    <span className={ styles.fieldHead }>{ label }</span>

    <div className={ styles.swatchRow }>
      <input
        type="color"
        value={ value }
        onChange={ e => onChange(e.target.value) }
        className={ styles.swatchPicker } />

      <input
        type="text"
        value={ value }
        onChange={ e => onChange(e.target.value) }
        className={ styles.swatchHex } />
    </div>
  </div>
}

type ToggleProps = PropsWithChildren<{

  /**
   * Named `pressed`, not `on`: a two-character prop starting with "on" crashes
   * the `react-strict/jsx-prop-layout` rule, which reads `name[2]` to decide if
   * a prop is an event handler without checking the length first.
   */
  pressed: boolean;
  onClick: () => void;
}>

function Toggle ({ pressed, onClick, children }: ToggleProps) {
  return <button
    onClick={ onClick }
    aria-pressed={ pressed }
    className={ pressed ? styles.toggleOn : styles.toggle }>
    { children }
  </button>
}

type SectionProps = { title: string; children: React.ReactNode }

function Section ({ title, children }: SectionProps) {
  return <fieldset className={ styles.section }>
    <legend className={ styles.legend }>{ title }</legend>
    { children }
  </fieldset>
}

const PATTERNS: { value: ShipConfig['texturePreset']; label: string }[] = [
  { value: 'plain', label: 'Plain' },
  { value: 'panels', label: 'Panels' },
  { value: 'carbon', label: 'Carbon Fiber' },
  { value: 'hazard', label: 'Hazard' },
  { value: 'city', label: 'Cityscape' },
  { value: 'gallery', label: 'Gallery' },
]

/** Random livery, in the spirit of the forge prototype's `randomize ✦`. */
function randomLook (): Partial<ShipConfig> {
  const palettes          = Object.entries(PALETTES)
  const [ name, palette ] = palettes[Math.floor(Math.random() * palettes.length)]
  return {
    paletteName:       name as ShipConfig['paletteName'],
    bodyColor:         palette.bodyColor,
    emissiveColor:     palette.emissiveColor,
    metalness:         0.2 + Math.random() * 0.75,
    roughness:         0.15 + Math.random() * 0.7,
    emissiveIntensity: 0.3 + Math.random() * 0.7,
    burnColor:         palette.emissiveColor,
    burnIntensity:     0.6 + Math.random() * 1.2,
    burnLength:        0.7 + Math.random() * 1.6,
  }
}

export function HangarControls () {
  const { currentConfig, updateConfig, selectShip, resetToDefault, applyToAllShips } = useShipStore()
  const view                                                                         = useHangarView()

  // Only the glTF ship (cb1) has its maps generated from texturePreset; every other ship
  // carries a baked livery that applyShipConfig() modulates but never overwrites.
  const activePreset   = SHIP_PRESETS[currentConfig.shipId]
  const hasBakedLivery = activePreset.kind !== 'gltf'

  const set = <K extends keyof ShipConfig>(key: K, value: ShipConfig[K]) =>
    updateConfig({ [key]: value } as Partial<ShipConfig>)

  const toggle = (key: HangarViewToggle) => () => view.toggle(key)

  return <div className={ styles.panel }>
    <header className={ styles.header }>
      <Link href="/" className={ styles.back }>‹ Menu</Link>
      <h1 className={ styles.title }>SHIP HANGAR</h1>

      <p className={ styles.subtitle }>
        { SHIP_IDS.length } hulls · drag to orbit · scroll to zoom
      </p>
    </header>

    <div className={ styles.sections }>
      <Section title="Fleet">
        <div className={ styles.ships }>
          { SHIP_IDS.map(id => {
            const preset = SHIP_PRESETS[id]
            const active = currentConfig.shipId === id
            return <button
              key={ id }
              onClick={ () => selectShip(id) }
              className={ active ? styles.shipActive : styles.ship }>
              <div className={ styles.shipName }>{ preset.label }</div>
              <div className={ styles.shipDesc }>{ preset.description }</div>
            </button>
          }) }
        </div>

        <div className={ styles.toggles }>
          <Toggle pressed={ false } onClick={ applyToAllShips }>apply livery to fleet</Toggle>
          <Toggle pressed={ false } onClick={ resetToDefault }>reset ship</Toggle>
          <Toggle pressed={ false } onClick={ () => updateConfig(randomLook()) }>randomize ✦</Toggle>
        </div>
      </Section>

      <Section title="Livery">
        <div className={ styles.palettes }>
          { Object.entries(PALETTES).map(([ key, palette ]) =>
            <button
              key={ key }
              onClick={ () => updateConfig({
                paletteName:       key as ShipConfig['paletteName'],
                bodyColor:         palette.bodyColor,
                emissiveColor:     palette.emissiveColor,
                metalness:         palette.metalness,
                roughness:         palette.roughness,
                emissiveIntensity: palette.emissiveIntensity,
              }) }
              className={ currentConfig.paletteName === key ? styles.paletteActive : styles.palette }>
              <div
                className={ styles.paletteSwatch }
                style={{ background: `linear-gradient(135deg, ${palette.bodyColor} 60%, ${palette.emissiveColor})` }} />

              <div className={ styles.paletteName }>{ palette.name }</div>
            </button>
          ) }
        </div>

        <Swatch label="body" value={ currentConfig.bodyColor } onChange={ v => set('bodyColor', v) } />
        <Swatch label="emissive" value={ currentConfig.emissiveColor } onChange={ v => set('emissiveColor', v) } />
      </Section>

      <Section title="Materials & Texture">
        <Slider
          label="metalness" value={ currentConfig.metalness }
          min={ 0 } max={ 1 } step={ 0.01 }
          onChange={ v => set('metalness', v) } />

        <Slider
          label="roughness" value={ currentConfig.roughness }
          min={ 0 } max={ 1 } step={ 0.01 }
          onChange={ v => set('roughness', v) } />

        <Slider
          label="emission" value={ currentConfig.emissiveIntensity }
          min={ 0 } max={ 1 } step={ 0.01 }
          onChange={ v => set('emissiveIntensity', v) } />

        { hasBakedLivery
          ? <p className={ styles.note }>
            { activePreset.label } ships a baked team livery — patterns are disabled so it stays
            recognisable. The sliders above still apply on top of it.
          </p>
          : <>
            <label className={ styles.field }>
              <span className={ styles.fieldHead }>pattern</span>

              <select
                value={ currentConfig.texturePreset }
                onChange={ e => set('texturePreset', e.target.value as ShipConfig['texturePreset']) }
                className={ styles.select }>
                { PATTERNS.map(p => <option key={ p.value } value={ p.value }>{ p.label }</option>) }
              </select>
            </label>

            <Slider
              label="texture repeat" value={ currentConfig.textureRepeat }
              min={ 0.5 } max={ 5 } step={ 0.25 }
              onChange={ v => set('textureRepeat', v) }
              format={ v => `${v.toFixed(2)}×` } />
          </> }
      </Section>

      <Section title="Afterburner">
        <Swatch label="plume" value={ currentConfig.burnColor } onChange={ v => set('burnColor', v) } />

        <Slider
          label="beam intensity" value={ currentConfig.burnIntensity }
          min={ 0 } max={ 2.2 } step={ 0.01 }
          onChange={ v => set('burnIntensity', v) } />

        <Slider
          label="beam length" value={ currentConfig.burnLength }
          min={ 0.4 } max={ 3 } step={ 0.01 }
          onChange={ v => set('burnLength', v) } />

        <Slider
          label="nozzle spread" value={ currentConfig.nozzleSpread }
          min={ 0 } max={ 1.6 } step={ 0.01 }
          onChange={ v => set('nozzleSpread', v) } />

        <p className={ styles.note }>
          Pods are found by scanning the hull&apos;s tail for its two thickest points, so 1.00 is
          wherever the geometry says the engines are — nudge it if a beam misses. The plume
          follows your throttle out on the track.
        </p>
      </Section>

      <Section title="View">
        <div className={ styles.toggles }>
          <Toggle pressed={ view.autoOrbit } onClick={ toggle('autoOrbit') }>auto-orbit</Toggle>
          <Toggle pressed={ view.flightTilt } onClick={ toggle('flightTilt') }>flight tilt</Toggle>
          <Toggle pressed={ view.engines } onClick={ toggle('engines') }>engines</Toggle>
          <Toggle pressed={ view.wireframe } onClick={ toggle('wireframe') }>wire overlay</Toggle>
        </div>
      </Section>
    </div>
  </div>
}
