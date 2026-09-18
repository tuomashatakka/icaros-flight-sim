/**
 * The regression net for the fail-closed default (docs/overhaul-report.md
 * §4.3 N2). `devTools` used to key off `NODE_ENV !== 'production'`, and
 * nothing in this repo guaranteed NODE_ENV was ever set — so the important
 * assertion here is not "COLYSEUS_DEVTOOLS works" but that NODE_ENV alone,
 * with the flag unset, is no longer enough to turn the monitor on.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadConfig } from '§config'


const ENV_KEYS = [ 'COLYSEUS_DEVTOOLS', 'NODE_ENV', 'PORT', 'HOST', 'RACE_GRID_BOTS' ] as const

let saved: Partial<Record<typeof ENV_KEYS[number], string>>

// Snapshot and restore rather than stubbing `process.env` wholesale, so a
// case that throws still leaves the other suites in this run with the
// environment they started with.
beforeEach(() => {
  saved = {}
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key]
    if (value === undefined)
      delete process.env[key]
    else
      process.env[key] = value
  }
})

describe('loadConfig', () => {
  it('fails closed with no environment at all', () => {
    const config = loadConfig()
    expect(config.devTools).toBe(false)
    expect(config.port).toBe(9003)
    expect(config.host).toBe('0.0.0.0')
    expect(config.raceGrid).toBe(4)
  })

  it('opts in with COLYSEUS_DEVTOOLS=1', () => {
    process.env.COLYSEUS_DEVTOOLS = '1'
    expect(loadConfig().devTools).toBe(true)
  })

  it('opts in with COLYSEUS_DEVTOOLS=true', () => {
    process.env.COLYSEUS_DEVTOOLS = 'true'
    expect(loadConfig().devTools).toBe(true)
  })

  it('stays off with COLYSEUS_DEVTOOLS=0', () => {
    process.env.COLYSEUS_DEVTOOLS = '0'
    expect(loadConfig().devTools).toBe(false)
  })

  it('ignores NODE_ENV on its own — that is the point of the fix', () => {
    process.env.NODE_ENV = 'development'
    expect(loadConfig().devTools).toBe(false)
  })

  it('throws on a non-numeric RACE_GRID_BOTS, naming the variable', () => {
    process.env.RACE_GRID_BOTS = 'abc'
    expect(() => loadConfig()).toThrow('RACE_GRID_BOTS')
  })

  it('falls back to the default port when PORT is empty', () => {
    process.env.PORT = ''
    expect(loadConfig().port).toBe(9003)
  })
})
