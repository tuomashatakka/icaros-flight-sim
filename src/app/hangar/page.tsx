'use client'

import { useCallback } from 'react'
import { SceneCanvas } from '@/components/scene-canvas'
import { HangarControls } from '@/components/hangar/hangar-controls'
import { mountHangar } from '@/engine/scenes/hangar'
import styles from './hangar.module.css'


export default function HangarPage () {
  // Stable identity: a new function would tear down the WebGL context. Ship
  // changes flow through zustand into app state instead of remounting.
  const mount = useCallback(async (canvas: HTMLCanvasElement) => mountHangar(canvas), [])

  return <div className={ styles.page }>
    <div aria-hidden className={ styles.wash } />

    <div className={ styles.layout }>
      <div className={ styles.viewport }>
        <SceneCanvas mount={ mount } />
      </div>

      <div className={ styles.panel }>
        <HangarControls />
      </div>
    </div>
  </div>
}
