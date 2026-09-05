import * as THREE from 'three'
import { detectRenderTier, tierDprCap } from './quality'
import type { RenderTier } from './quality'

export type RendererQualityOptions = {
  desktopDprCap?: number;
  powerPreference?: WebGLPowerPreference;
}

export function createGameRenderer (canvas: HTMLCanvasElement, options: RendererQualityOptions = {}) {
  const tier = detectRenderTier(canvas)
  const renderer = new THREE.WebGLRenderer({
    canvas,
    powerPreference: options.powerPreference ?? 'high-performance',
    antialias:       tier === 'high',
    alpha:           false,
    precision:       tier === 'low' ? 'mediump' : 'highp',
    depth:           true,
    stencil:         false,
  })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, tierDprCap(tier, options.desktopDprCap)))
  const parent = canvas.parentElement ?? document.body
  renderer.setSize(parent.clientWidth, parent.clientHeight, false)
  return { renderer, tier }
}

export type { RenderTier }
