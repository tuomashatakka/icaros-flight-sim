import * as THREE from 'three'


export type RendererQuality = 'low' | 'medium' | 'high'

export type ShadowQuality = {
  enabled:           boolean;
  blobShadow:        boolean;
  mapSize:           number;
  updateEveryFrames: number;
  frustum:           number;
  maxCasterDistance: number;
}

export type RendererQualityPreset = {
  shadow: ShadowQuality;
}

/** Mobile tiers intentionally stop at 1024 until a device benchmark earns more. */
export const RENDERER_QUALITY: Record<RendererQuality, RendererQualityPreset> = {
  low: {
    shadow: { enabled: false, blobShadow: true, mapSize: 512, updateEveryFrames: 4, frustum: 32, maxCasterDistance: 36 },
  },
  medium: {
    shadow: { enabled: true, blobShadow: false, mapSize: 1024, updateEveryFrames: 2, frustum: 42, maxCasterDistance: 56 },
  },
  high: {
    shadow: { enabled: true, blobShadow: false, mapSize: 2048, updateEveryFrames: 1, frustum: 48, maxCasterDistance: 72 },
  },
}

export function resolveRendererQuality (): RendererQuality {
  if (typeof window === 'undefined')
    return 'low'

  if (process.env.NODE_ENV !== 'production') {
    const override = new URLSearchParams(window.location.search).get('quality')
    if (override === 'low' || override === 'medium' || override === 'high')
      return override
  }

  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const cores  = navigator.hardwareConcurrency ?? 4
  if (coarse)
    return cores >= 6 ? 'medium' : 'low'
  return cores >= 6 ? 'high' : 'medium'
}

/** Opt a sizeable static mesh into the moving local shadow region. */
export function localShadowCaster (mesh: THREE.Mesh, radius = 0): void {
  mesh.userData.localShadowCaster = { radius }
  mesh.castShadow                 = false
}

export function updateLocalShadowCasters (
  scene: THREE.Scene,
  anchor: THREE.Vector3,
  maxDistance: number
): void {
  scene.traverse(object => {
    const marker = object.userData.localShadowCaster as { radius: number } | undefined
    if (!marker || !(object instanceof THREE.Mesh))
      return

    // Radius makes the hand-off happen beyond the visible edge of large
    // structures; the extra two metres are hysteresis against boundary flicker.
    const threshold   = maxDistance + marker.radius + (object.castShadow ? 2 : 0)
    object.castShadow = object.getWorldPosition(_casterPosition).distanceToSquared(anchor) <= threshold * threshold
  })
}

const _casterPosition = new THREE.Vector3()
