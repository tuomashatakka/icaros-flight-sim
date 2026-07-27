'use client'

import { useCallback } from 'react'
import { SceneCanvas } from '@/components/scene-canvas'
import { HangarControls } from '@/components/hangar/hangar-controls'
import { mountHangar } from '@/engine/scenes/hangar'


export default function HangarPage () {
  // Stable identity: a new function would tear down the WebGL context. Ship
  // changes flow through zustand into app state instead of remounting.
  const mount = useCallback(async (canvas: HTMLCanvasElement) => mountHangar(canvas), [])

  return <div className="relative min-h-screen w-full overflow-hidden bg-background">
    <div className="absolute inset-0 bg-gradient-to-br from-purple-900/20 via-background to-cyan-900/20" />

    <div className="relative z-10 flex h-screen flex-col lg:flex-row">
      <div className="flex-1">
        <SceneCanvas mount={ mount } />
      </div>

      <div className="w-full lg:w-96">
        <HangarControls />
      </div>
    </div>
  </div>
}
