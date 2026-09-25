'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DEFAULT_SETTINGS, SETTINGS_LIMITS, settingsActions, settingsStore } from 'Ƨ'
import type { SettingsState } from 'Ƨ'
import { useStoreState } from 'Ƨreact'
import { hudThemeVars } from '../hud-theme'
import chrome from '../hud-chrome.module.css'
import menu from '../main-menu.module.css'
import styles from './settings-page.module.css'


type Option<T extends string | number> = { value: T; label: string; hint?: string }

const PRESETS: readonly Option<SettingsState['preset']>[] = [
  { value: 'auto', label: 'Auto', hint: 'adapts to frame time' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

const RESOLUTIONS: readonly Option<SettingsState['resolution']>[] = [
  { value: 'auto', label: 'Auto', hint: 'up to 1.5x, 1440 lines' },
  { value: 'native', label: 'Native', hint: 'full device resolution' },
  { value: '2160', label: '2160p' },
  { value: '1440', label: '1440p' },
  { value: '1080', label: '1080p' },
  { value: '900', label: '900p' },
  { value: '720', label: '720p' },
  { value: '540', label: '540p' },
]

const FRAME_CAPS: readonly Option<`${SettingsState['frameCap']}`>[] = [
  { value: '0', label: 'Display' },
  { value: '120', label: '120' },
  { value: '60', label: '60' },
  { value: '30', label: '30' },
]

const ANTIALIAS: readonly Option<SettingsState['antialias']>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'smaa', label: 'SMAA' },
  { value: 'fxaa', label: 'FXAA' },
  { value: 'off', label: 'Off' },
]

const SHADOWS: readonly Option<SettingsState['shadows']>[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'High' },
  { value: 'low', label: 'Low' },
  { value: 'off', label: 'Off' },
]

const TOUCH: readonly Option<SettingsState['touchControls']>[] = [
  { value: 'auto', label: 'Auto', hint: 'on touchscreens' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
]

const KEYS: ReadonlyArray<[string, string]> = [
  [ 'W / ↑', 'Thrust' ],
  [ 'S / ↓', 'Brake · reverse' ],
  [ 'A D / ← →', 'Turn' ],
  [ 'Q E', 'Strafe left / right' ],
  [ 'Mouse', 'Turn, and nudge the camera (click to capture, Esc to release)' ],
  [ 'R F', 'Aim / look up · down' ],
  [ 'Shift', 'Boost' ],
  [ 'Space · click / X', 'Battle: primary / secondary weapon' ],
  [ 'C', 'Chase ⇄ cockpit' ],
  [ 'Backspace', 'Respawn' ],
]

type SegmentedProps<T extends string | number> = {
  label:    string;
  value:    T;
  options:  readonly Option<T>[];
  onChange: (value: T) => void;
}

function Segmented<T extends string | number> ({ label, value, options, onChange }: SegmentedProps<T>) {
  const hint = options.find(option => option.value === value)?.hint
  return <div className={ styles.row }>
    <span className={ `${styles.label} ${chrome.caption}` }>{ label }</span>

    <div className={ styles.segmented } role="radiogroup" aria-label={ label }>
      { options.map(option =>
        <button
          key={ String(option.value) }
          type="button"
          role="radio"
          aria-checked={ option.value === value }
          className={ `${styles.segment} ${option.value === value ? styles.selected : ''}` }
          onClick={ () => onChange(option.value) }>
          { option.label }
        </button>
      ) }
    </div>

    { hint && <span className={ `${styles.hint} ${chrome.mono}` }>{ hint }</span> }
  </div>
}

type ToggleProps = {
  label:    string;
  checked:  boolean;
  hint?:    string;
  onChange: (value: boolean) => void;
}

function Toggle ({ label, checked, hint, onChange }: ToggleProps) {
  return <div className={ styles.row }>
    <span className={ `${styles.label} ${chrome.caption}` }>{ label }</span>

    <button
      type="button"
      role="switch"
      aria-checked={ checked }
      aria-label={ label }
      className={ `${styles.toggle} ${checked ? styles.on : ''}` }
      onClick={ () => onChange(!checked) }>
      <span className={ styles.knob } />
      <span className={ chrome.caption }>{ checked ? 'On' : 'Off' }</span>
    </button>

    { hint && <span className={ `${styles.hint} ${chrome.mono}` }>{ hint }</span> }
  </div>
}

type SliderProps = {
  label:    string;
  value:    number;
  limits:   { min: number; max: number; step: number };
  format:   (value: number) => string;
  onChange: (value: number) => void;
}

function Slider ({ label, value, limits, format, onChange }: SliderProps) {
  return <label className={ styles.row }>
    <span className={ `${styles.label} ${chrome.caption}` }>{ label }</span>

    <input
      type="range"
      className={ styles.range }
      min={ limits.min }
      max={ limits.max }
      step={ limits.step }
      value={ value }
      onChange={ event => onChange(Number(event.target.value)) } />

    <span className={ `${styles.value} ${chrome.mono}` }>{ format(value) }</span>
  </label>
}

/** Fullscreen state, from the document rather than from a flag of our own. */
function useFullscreen (): [ boolean, () => void, boolean ] {
  const [ active, setActive ]       = useState(false)
  const [ supported, setSupported ] = useState(true)

  useEffect(() => {
    const sync = () => setActive(document.fullscreenElement !== null)
    setSupported(typeof document.documentElement.requestFullscreen === 'function')
    sync()
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const toggle = useCallback(() => {
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {})
    else
      void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
  }, [])

  return [ active, toggle, supported ]
}

const percent = (value: number) => `${Math.round(value * 100)}%`

/**
 * Graphics, camera and controls.
 *
 * Every control writes straight into `settingsStore`, which persists itself and
 * which a mounted scene is subscribed to — so there is no "apply" step and
 * nothing here knows how the renderer uses a value.
 */
export function SettingsPage () {
  const settings                                        = useStoreState(settingsStore)
  const [ fullscreen, toggleFullscreen, canFullscreen ] = useFullscreen()
  const router                                          = useRouter()
  const set                                             = settingsActions.set

  const back = useCallback(() => {
    // Came from the game or the menu: go back there. Landed here directly: the menu.
    if (window.history.length > 1)
      router.back()
    else
      router.push('/')
  }, [ router ])

  return <main className={ menu.page } style={ hudThemeVars }>
    <div aria-hidden className={ menu.glow } />
    <div aria-hidden className={ `${chrome.grid} ${menu.backdropGrid}` } />

    <div className={ `${menu.inner} ${styles.inner}` }>
      <header className={ `${styles.header} ${chrome.bracketed}` }>
        <p className={ `${menu.eyebrow} ${chrome.caption} ${chrome.glow}` }>Systems</p>
        <h1 className={ `${styles.title} ${chrome.glow}` }>SETTINGS</h1>

        <div className={ styles.headerActions }>
          <button type="button" className={ `${styles.action} ${chrome.glass} ${chrome.caption}` } onClick={ back }>‹ Back</button>
          <button type="button" className={ `${styles.action} ${chrome.glass} ${chrome.caption}` } onClick={ () => settingsActions.reset() }>Reset defaults</button>
        </div>
      </header>

      <section className={ `${styles.panel} ${chrome.glass} ${chrome.bracketed}` } aria-labelledby="graphics">
        <h2 id="graphics" className={ `${styles.panelTitle} ${chrome.caption}` }>Graphics</h2>

        <div className={ styles.row }>
          <span className={ `${styles.label} ${chrome.caption}` }>Display mode</span>

          <button
            type="button"
            className={ `${styles.segment} ${fullscreen ? styles.selected : ''}` }
            disabled={ !canFullscreen }
            onClick={ toggleFullscreen }>
            { fullscreen ? 'Fullscreen ✓' : 'Windowed' }
          </button>

          <span className={ `${styles.hint} ${chrome.mono}` }>{ canFullscreen ? 'click to toggle' : 'not supported here' }</span>
        </div>

        <Segmented label="Quality" value={ settings.preset } options={ PRESETS } onChange={ value => set('preset', value) } />
        <Segmented label="Resolution" value={ settings.resolution } options={ RESOLUTIONS } onChange={ value => set('resolution', value) } />

        <Segmented
          label="Frame rate cap"
          value={ `${settings.frameCap}` as `${SettingsState['frameCap']}` }
          options={ FRAME_CAPS }
          onChange={ value => set('frameCap', Number(value) as SettingsState['frameCap']) } />

        <Segmented label="Anti-aliasing" value={ settings.antialias } options={ ANTIALIAS } onChange={ value => set('antialias', value) } />
        <Segmented label="Shadows" value={ settings.shadows } options={ SHADOWS } onChange={ value => set('shadows', value) } />
        <Toggle label="Post effects" checked={ settings.postEffects } hint="bloom, grade, lens" onChange={ value => set('postEffects', value) } />
        <Toggle label="Depth of field" checked={ settings.depthOfField } hint="high quality only" onChange={ value => set('depthOfField', value) } />
        <Toggle label="Motion blur" checked={ settings.motionBlur } hint="speed streaks" onChange={ value => set('motionBlur', value) } />
        <Slider label="Field of view" value={ settings.fov } limits={ SETTINGS_LIMITS.fov } format={ value => `${value}°` } onChange={ value => set('fov', value) } />
        <p className={ `${styles.note} ${chrome.mono}` }>Frame rate cap applies the next time a track loads.</p>
      </section>

      <section className={ `${styles.panel} ${chrome.glass} ${chrome.bracketed}` } aria-labelledby="camera">
        <h2 id="camera" className={ `${styles.panelTitle} ${chrome.caption}` }>Camera</h2>
        <Slider label="Motion response" value={ settings.cameraMotion } limits={ SETTINGS_LIMITS.cameraMotion } format={ percent } onChange={ value => set('cameraMotion', value) } />
        <Slider label="Impact shake" value={ settings.cameraShake } limits={ SETTINGS_LIMITS.cameraShake } format={ percent } onChange={ value => set('cameraShake', value) } />
      </section>

      <section className={ `${styles.panel} ${chrome.glass} ${chrome.bracketed}` } aria-labelledby="controls">
        <h2 id="controls" className={ `${styles.panelTitle} ${chrome.caption}` }>Controls</h2>
        <Toggle label="Capture mouse" checked={ settings.pointerLock } hint="click the game to capture, Esc releases" onChange={ value => set('pointerLock', value) } />
        <Slider label="Mouse sensitivity" value={ settings.mouseSensitivity } limits={ SETTINGS_LIMITS.mouseSensitivity } format={ value => `${value.toFixed(2)}x` } onChange={ value => set('mouseSensitivity', value) } />
        <Toggle label="Invert mouse Y" checked={ settings.invertMouseY } onChange={ value => set('invertMouseY', value) } />
        <Segmented label="Touch controls" value={ settings.touchControls } options={ TOUCH } onChange={ value => set('touchControls', value) } />

        <dl className={ styles.keys }>
          { KEYS.map(([ key, action ]) => <div key={ key } className={ styles.key }>
            <dt className={ chrome.mono }>{ key }</dt>
            <dd>{ action }</dd>
          </div>) }
        </dl>
      </section>

      <p className={ `${styles.note} ${chrome.mono}` }>
        Saved on this device. Defaults: { DEFAULT_SETTINGS.preset } quality, { DEFAULT_SETTINGS.resolution } resolution.
      </p>
    </div>
  </main>
}
