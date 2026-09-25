'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { settingsStore } from 'Ƨ'
import { useStoreState } from 'Ƨreact'
import { hudThemeVars } from './hud-theme'
import styles from './game-chrome.module.css'


/**
 * The two things a player needs from outside the canvas while flying: the
 * settings, and fullscreen. And, until the mouse is captured, how to capture it.
 *
 * DOM rather than a HUD plate on purpose. Fullscreen and pointer capture are
 * both granted only inside a user gesture on a real element, and a settings
 * link is a navigation — none of which the canvas HUD is the right owner of.
 */
export function GameChrome () {
  const pointerLock            = useStoreState(settingsStore, state => state.pointerLock)
  const [ locked, setLocked ]  = useState(false)
  const [ full, setFull ]      = useState(false)
  const [ fineMouse, setFine ] = useState(false)
  const [ quiet, setQuiet ]    = useState(false)

  useEffect(() => {
    const sync = () => {
      setLocked(document.pointerLockElement instanceof HTMLCanvasElement)
      setFull(document.fullscreenElement !== null)
    }
    // A hint about capturing a mouse means nothing to a phone.
    setFine(window.matchMedia('(any-pointer: fine)').matches && navigator.maxTouchPoints === 0)
    sync()
    document.addEventListener('pointerlockchange', sync)
    document.addEventListener('fullscreenchange', sync)

    const timer = window.setTimeout(() => setQuiet(true), 6000)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerlockchange', sync)
      document.removeEventListener('fullscreenchange', sync)
    }
  }, [])

  const toggleFullscreen = () => {
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {})
    else
      void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {})
  }

  return <div className={ styles.root } style={ hudThemeVars }>
    <div className={ `${styles.bar} ${locked ? styles.dimmed : ''}` }>
      <button type="button" className={ styles.button } onClick={ toggleFullscreen } aria-label={ full ? 'Exit fullscreen' : 'Fullscreen' } title={ full ? 'Exit fullscreen' : 'Fullscreen' }>
        { full ? '⤡' : '⤢' }
      </button>

      <Link href="/settings" className={ styles.button } aria-label="Settings" title="Settings">⚙</Link>
    </div>

    { pointerLock && fineMouse && !locked &&
      <p className={ `${styles.hint} ${quiet ? styles.quiet : ''}` } role="status">
        Click to fly with the mouse · Esc releases it
      </p> }
  </div>
}
