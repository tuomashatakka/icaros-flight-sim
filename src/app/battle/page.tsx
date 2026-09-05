'use client'

import { Suspense, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { SceneCanvas } from '@/components/scene-canvas'
import { mountBattle } from '@/engine/scenes/battle'
import { useShipStore } from '@/hooks/use-ship-store'
import type { ShipId } from '@/lib/ship/registry'
import styles from './battle.module.css'


function BattleContent () {
  const params = useSearchParams()
  const mount  = useCallback((canvas: HTMLCanvasElement) => {
    const name = params.get('n')
    const ship = params.get('ship')

    // Read the hangar loadout through `getState`, not a hook: `mount` has to
    // stay referentially stable or SceneCanvas tears the WebGL context down and
    // rebuilds the whole match on every livery tweak.
    const config = useShipStore.getState().currentConfig
    return mountBattle(canvas, {
      name:    name || 'nuller',
      shipId:  (ship as ShipId) || config.shipId,
      loadout: { primary: config.primaryWeapon, secondary: config.secondaryWeapon },

      // Battle is network-only. `?match=` picks a room (the lobby hands one
      // out); `?sv=` overrides the server for local debugging, which the old
      // transport documented but never implemented.
      match:  params.get('match') ?? undefined,
      server: params.get('sv') ?? undefined,
    })
  }, [ params ])

  return <div className={ styles.page }>
    <SceneCanvas mount={ mount } fallback={ false } />
  </div>
}

export default function BattlePage () {
  return <Suspense fallback={ <div className={ styles.page } /> }>
    <BattleContent />
  </Suspense>
}
