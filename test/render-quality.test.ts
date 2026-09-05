import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { RENDERER_QUALITY, localShadowCaster, updateLocalShadowCasters } from '../src/engine/render-quality'


describe('renderer shadow quality', () => {
  it('keeps mobile-capable tiers at 1024 or below', () => {
    expect(RENDERER_QUALITY.low.shadow.mapSize).toBeLessThanOrEqual(1024)
    expect(RENDERER_QUALITY.medium.shadow.mapSize).toBeLessThanOrEqual(1024)
    expect(RENDERER_QUALITY.low.shadow).toMatchObject({ enabled: false, blobShadow: true })
  })

  it('admits local static casters with a hysteretic boundary', () => {
    const scene       = new THREE.Scene()
    const caster      = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    caster.position.x = 9
    localShadowCaster(caster)
    scene.add(caster)

    updateLocalShadowCasters(scene, new THREE.Vector3(), 10)
    expect(caster.castShadow).toBe(true)

    caster.position.x = 11
    updateLocalShadowCasters(scene, new THREE.Vector3(), 10)
    expect(caster.castShadow).toBe(true)

    caster.position.x = 13
    updateLocalShadowCasters(scene, new THREE.Vector3(), 10)
    expect(caster.castShadow).toBe(false)
  })
})
