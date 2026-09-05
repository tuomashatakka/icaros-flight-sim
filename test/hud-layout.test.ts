import { describe, expect, it } from 'vitest'
import { hudVisorPoint, HUD_PANEL_TRACES, HUD_VISOR_BOUNDS, HUD_VISOR_FACETS, HUD_VISOR_SURFACE } from '@/engine/hud/layout'
import type { HudVisorCorners } from '@/engine/hud/layout'
import type { HudPanelKey } from '@/engine/hud/types'


const facets = new Map(HUD_VISOR_FACETS.map(facet => [ facet.key, facet.corners ]))

function corners (key: HudPanelKey): HudVisorCorners {
  const value = facets.get(key)
  if (!value)
    throw new Error(`missing hud facet ${key}`)
  return value
}

function normalY (quad: HudVisorCorners): number {
  const [ a, b, c ] = quad
  const abX         = b[0] - a[0]
  const abZ         = b[2] - a[2]
  const acX         = c[0] - a[0]
  const acZ         = c[2] - a[2]
  return abZ * acX - abX * acZ
}

describe('continuous hud visor', () => {
  it('clusters the traced readouts around an open sightline', () => {
    const topLeft      = corners('topLeft')
    const topCenter    = corners('topCenter')
    const topRight     = corners('topRight')
    const bottomLeft   = corners('bottomLeft')
    const bottomCenter = corners('bottomCenter')
    const bottomRight  = corners('bottomRight')

    expect(topLeft[1][0]).toBeLessThan(0)
    expect(topRight[0][0]).toBeGreaterThan(0)
    expect(topCenter[0][1]).toBeGreaterThan(topLeft[0][1])
    expect(bottomLeft[1][0]).toBeLessThan(0)
    expect(bottomCenter[1][0]).toBeLessThan(0)
    expect(bottomRight[0][0]).toBeGreaterThan(0)
    expect(bottomCenter[1][0]).toBeLessThan(bottomRight[0][0])
  })

  it('faces the canopy strip and lower screens toward the pilot', () => {
    const top    = corners('topCenter')
    const bottom = corners('bottomCenter')

    expect(top[2][2]).toBeLessThan(top[0][2])
    expect(bottom[0][2]).toBeLessThan(bottom[2][2])
    expect(normalY(top)).toBeGreaterThan(0)
    expect(normalY(bottom)).toBeLessThan(0)
    expect(HUD_VISOR_SURFACE).toHaveLength(9)
  })

  it('recesses the sight while folding both wings toward the pilot', () => {
    const topLeft = corners('topLeft')
    const center  = hudVisorPoint(0, 0)
    const rim     = hudVisorPoint(0, HUD_VISOR_BOUNDS.innerY)

    expect(center[2]).toBeLessThan(rim[2])
    expect(topLeft[0][2]).toBeGreaterThan(topLeft[1][2])
  })

  it('keeps every traced cockpit silhouette inside its interactive uv surface', () => {
    const traces  = Object.values(HUD_PANEL_TRACES)
    const open    = traces.filter(trace => trace.variant === 'open')
    const screens = traces.filter(trace => trace.variant === 'screen')

    expect(open).toHaveLength(3)
    expect(screens).toHaveLength(3)
    for (const trace of open) {
      expect(trace.frame).toBeDefined()
      expect(trace.frame!.length).toBeGreaterThan(0)
    }
    for (const trace of screens)
      expect(trace.frame).toBeUndefined()

    for (const trace of traces) {
      expect(trace.contour.length).toBeGreaterThanOrEqual(4)

      const points = [ ...trace.contour, ...trace.frame?.flat() ?? [] ]
      for (const point of points) {
        expect(point[0]).toBeGreaterThanOrEqual(0)
        expect(point[0]).toBeLessThanOrEqual(1)
        expect(point[1]).toBeGreaterThanOrEqual(0)
        expect(point[1]).toBeLessThanOrEqual(1)
      }
    }
  })
})
