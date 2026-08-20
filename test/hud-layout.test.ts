import { describe, expect, it } from 'vitest'
import { HUD_VISOR_FACETS, HUD_VISOR_SURFACE } from '@/engine/hud/layout'
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
  const abX = b[0] - a[0]
  const abZ = b[2] - a[2]
  const acX = c[0] - a[0]
  const acZ = c[2] - a[2]
  return abZ * acX - abX * acZ
}

describe('continuous hud visor', () => {
  it('shares exact seams across every top and bottom neighbour', () => {
    const topLeft     = corners('topLeft')
    const topCenter   = corners('topCenter')
    const topRight    = corners('topRight')
    const bottomLeft  = corners('bottomLeft')
    const bottomCenter = corners('bottomCenter')
    const bottomRight = corners('bottomRight')

    expect([ topLeft[1], topLeft[3] ]).toEqual([ topCenter[0], topCenter[2] ])
    expect([ topCenter[1], topCenter[3] ]).toEqual([ topRight[0], topRight[2] ])
    expect([ bottomLeft[1], bottomLeft[3] ]).toEqual([ bottomCenter[0], bottomCenter[2] ])
    expect([ bottomCenter[1], bottomCenter[3] ]).toEqual([ bottomRight[0], bottomRight[2] ])
  })

  it('joins the targeting pane and faces both rows toward the pilot', () => {
    const top    = corners('topCenter')
    const center = corners('center')
    const bottom = corners('bottomCenter')

    expect([ top[0], top[1] ]).toEqual([ center[2], center[3] ])
    expect([ bottom[2], bottom[3] ]).toEqual([ center[0], center[1] ])
    expect(normalY(top)).toBeLessThan(0)
    expect(normalY(bottom)).toBeGreaterThan(0)
    expect(HUD_VISOR_SURFACE).toHaveLength(9)
  })
})
