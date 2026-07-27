'use client'

import { TuningPanel } from '@/components/tuning-panel'
import { BackToMenu } from './back-to-menu'
import { ControlsHint } from './controls-hint'
import { Countdown } from './countdown'
import { CrashFlash } from './crash-flash'
import { FinishCard } from './finish-card'

/**
 * The DOM half of the race UI.
 *
 * Everything that reports on the ship — speed, boost, lap, elapsed, the horizon,
 * the next gate — is drawn in the scene by `src/engine/hud/`, as emissive
 * geometry the composer's bloom lights up. What remains here is chrome that is
 * about the SESSION rather than the flight, plus the tuning panel.
 */
export function GameUI () {
  return <>
    <TuningPanel />
    <BackToMenu />
    <Countdown />
    <FinishCard />
    <CrashFlash />
    <ControlsHint />
  </>
}
