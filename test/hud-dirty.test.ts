import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HudPanel, readHudPanelMetrics, resetHudPanelMetrics } from '@/engine/hud/panel'


describe('hud panel dirty tracking', () => {
  beforeEach(resetHudPanelMetrics)

  it('performs zero canvas texture uploads once an idle panel has settled', () => {
    const begin  = vi.fn()
    const finish = vi.fn()
    const draw   = vi.fn()
    const panel  = {
      title:   'navigation',
      hovered: null,
      canvas:  { width: 640, height: 320 },
      begin,
      finish,
    } as unknown as HudPanel

    const render = HudPanel.prototype.render.bind(panel)
    expect(render('race|topLeft|idle', 1, draw)).toBe(true)

    const settledUploads = readHudPanelMetrics().textureUploads

    for (let frame = 0; frame < 120; frame++)
      expect(render('race|topLeft|idle', 1 + frame / 60, draw)).toBe(false)

    expect(readHudPanelMetrics().textureUploads - settledUploads).toBe(0)
    expect(begin).toHaveBeenCalledOnce()
    expect(draw).toHaveBeenCalledOnce()
    expect(finish).toHaveBeenCalledOnce()
  })
})
