'use client'

import { useCameraView } from '@/hooks/use-camera-view'
import styles from './hud.module.css'

/** Key reference. Reads the camera mirror so the view line describes where you actually are. */
export function ControlsHint () {
  const view = useCameraView(s => s.view)

  return <div className={ styles.controls }>
    <p>
      <kbd>W</kbd>
      Thrust
    </p>

    <p>
      <kbd>S</kbd>
      Brake
    </p>

    <p>
      <kbd>A D</kbd>
      Steer
    </p>

    <p>
      <kbd>⇧</kbd>
      Boost
    </p>

    <p>
      <kbd>C</kbd>
      { view === 'cockpit' ? 'Chase view' : 'Cockpit view' }
    </p>

    <p>
      <kbd>R</kbd>
      Respawn
    </p>
  </div>
}
