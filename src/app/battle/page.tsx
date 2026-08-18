'use client'

import { Suspense, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { SceneCanvas } from '@/components/scene-canvas'
import { BattleUI } from '@/components/battle/battle-ui'
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
    return mountBattle(
      canvas,
      name || 'nuller',
      (ship as ShipId) || config.shipId,
      { primary: config.primaryWeapon, secondary: config.secondaryWeapon }
    )
  }, [ params ])

  return <div className={ styles.page }>
    <div aria-hidden className={ styles.wash } />

    <div className={ styles.layout }>
      <div className={ styles.viewport }>
        <SceneCanvas mount={ mount } />
        <BattleUI />
      </div>
    </div>
  </div>
}

export default function BattlePage () {
  return <Suspense fallback={ <div className={ styles.page } /> }>
    <BattleContent />
  </Suspense>
}
