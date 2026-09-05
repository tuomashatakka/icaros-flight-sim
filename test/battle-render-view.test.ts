import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { BATTLE_EFFECT_BUDGETS, BattleRenderView, withinBudget } from 'Δengine/battle/render-view'


describe('battle render view', () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1600)
  camera.position.set(0, 0, 0)
  camera.lookAt(0, 0, -1)

  it('keeps nearby and targeted combatants at full rate', () => {
    const view = new BattleRenderView()
    view.beginFrame(camera, 720)

    expect(view.sample({ position: { x: 0, y: 0, z: -40 }, radius: 3, kind: 'remote' }).tier).toBe('full')
    expect(view.sample({ position: { x: 0, y: 0, z: -700 }, radius: 3, kind: 'remote', target: true }).tier).toBe('full')
  })

  it('uses transform-only and hidden tiers for tiny distant objects', () => {
    const view = new BattleRenderView()
    view.beginFrame(camera, 720)

    expect(view.sample({ position: { x: 0, y: 0, z: -500 }, radius: 3, kind: 'remote' }).tier).toBe('transform')
    expect(view.sample({ position: { x: 0, y: 0, z: -1500 }, radius: 0.2, kind: 'projectile' }).tier).toBe('hidden')
    expect(view.sample({ position: { x: 1000, y: 0, z: -20 }, radius: 3, kind: 'remote' }).inFrustum).toBe(false)
  })

  it('never lets an effect list exceed its quality budget', () => {
    const values   = Array.from({ length: 100 }, (_, importance) => ({ importance }))
    const selected = withinBudget(values, BATTLE_EFFECT_BUDGETS.low.beams, value => value.importance)

    expect(selected).toHaveLength(BATTLE_EFFECT_BUDGETS.low.beams)
    expect(selected[0]?.importance).toBe(99)
  })
})
