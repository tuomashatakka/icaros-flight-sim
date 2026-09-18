/**
 * `defineStore` adds three things to the library store — slice subscriptions,
 * functional patches and the zustand-shaped localStorage envelope — and each
 * one has a way to be subtly wrong that nothing else in the tree would notice:
 * a `select` that fires on unrelated fields drives the HUD from every store
 * write, and an envelope that stops matching `{ state, version }` loses every
 * saved livery on the next deploy.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { defineStore } from 'Ƨ'


type Shape = { a: number; b: string }

afterEach(() => vi.unstubAllGlobals())

describe('defineStore', () => {
  it('select fires once per change of the selected value only', () => {
    const store = defineStore<Shape>({ a: 1, b: 'x' })
    const seen  = vi.fn()
    store.select(state => state.a, seen)

    store.update(() => ({ b: 'y' }))
    store.update(() => ({ a: 2 }))
    store.update(() => ({ a: 2 }))

    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen).toHaveBeenCalledWith(2, 1)
  })

  it('update ignores an empty patch and the state itself', () => {
    const store = defineStore<Shape>({ a: 1, b: 'x' })
    const seen  = vi.fn()
    store.subscribe(seen)

    store.update(() => ({}))
    store.update(state => state)

    expect(seen).not.toHaveBeenCalled()
  })

  it('round-trips the zustand-shaped envelope and migrates an older version', () => {
    const saved: Record<string, string> = { pilot: JSON.stringify({ state: { a: 5 }, version: 1 }) }
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => saved[key] ?? null,
        setItem: (key: string, value: string) => {
          saved[key] = value
        },
      },
    })

    const store = defineStore<Shape>({ a: 1, b: 'x' }, {
      name:       'pilot',
      version:    2,
      partialize: state => ({ a: state.a }),
      migrate:    (old, version) => version === 1 ? { a: (old.a ?? 0) * 10 } : old,
    })

    expect(store.get()).toEqual({ a: 50, b: 'x' })

    store.update(() => ({ a: 7 }))
    expect(JSON.parse(saved.pilot)).toEqual({ state: { a: 7 }, version: 2 })
  })
})
