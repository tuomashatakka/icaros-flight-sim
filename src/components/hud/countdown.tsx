'use client'

import { useRaceStore } from '@/hooks/use-race-store'
import styles from './hud.module.css'

/**
 * The 3-2-1 gate and the GO! flash.
 *
 * Stays in the DOM rather than moving to the holographic HUD: it is a
 * full-screen, pre-race moment, and the canopy is not yet the thing you are
 * looking at.
 */
export function Countdown () {
  const status    = useRaceStore(s => s.status)
  const countdown = useRaceStore(s => s.countdown)
  const elapsed   = useRaceStore(s => s.elapsed)

  if (status === 'countdown')
    return <div className={ styles.centreOverlay }>
      <span key={ Math.ceil(countdown) } className={ styles.countdown }>
        { Math.ceil(countdown) }
      </span>
    </div>

  if (status === 'racing' && elapsed < 1)
    return <div className={ styles.centreOverlay }>
      <span className={ styles.go }>GO!</span>
    </div>

  return null
}
