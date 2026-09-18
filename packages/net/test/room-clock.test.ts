/**
 * `pongFor` is the PING/PONG reply every room sends, race and battle alike.
 *
 * `nowMs` is injectable so the reply is assertable without depending on the
 * wall clock — `NetClock` (`clock.ts`) samples its offset from exactly this
 * shape, so a wrong field here is a silent clock bug on whichever mode hits it.
 */

import { describe, expect, it } from 'vitest'

import { pongFor } from 'Ξroom-clock'


describe('pongFor', () => {
  it('echoes t0 and serverTick, and stamps the injected time', () => {
    expect(pongFor(111, 42, 999000)).toEqual({ t0: 111, serverTimeMs: 999000, serverTick: 42 })
  })

  it('stamps a different reply when the injected time differs', () => {
    expect(pongFor(111, 42, 1000)).not.toEqual(pongFor(111, 42, 2000))
  })

  it('defaults serverTimeMs to the wall clock when nothing is injected', () => {
    const before = Date.now()
    const pong   = pongFor(0, 0)
    const after  = Date.now()

    expect(pong.serverTimeMs).toBeGreaterThanOrEqual(before)
    expect(pong.serverTimeMs).toBeLessThanOrEqual(after)
  })
})
