'use client'

import { Suspense, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { SceneCanvas } from '@/components/scene-canvas'
import { BattleUI } from '@/components/battle/battle-ui'
import { mountBattle } from '@/engine/scenes/battle'
import type { ShipId } from '@/lib/ship/registry'
import styles from './battle.module.css'


function BattleContent () {
  const params = useSearchParams()
  const mount  = useCallback((canvas: HTMLCanvasElement) => {
    const name = params.get('n')
    const ship = params.get('ship')
    return mountBattle(canvas, name || 'nuller', (ship as ShipId) || 'icaras')
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
