import { createStore } from 'threejs-scene'
import type { Store } from 'threejs-scene'

/**
 * Client state lives in `threejs-scene` stores.
 *
 * The library's `createStore` is the same primitive every `App` keeps its own
 * state in (`app.store`), so the engine and the DOM layer now read one kind of
 * store. This module adds the two things the app needs on top of it: slice
 * subscriptions (`select`) and functional patches (`update`), plus an optional
 * localStorage envelope that stays byte-compatible with the saves zustand's
 * `persist` middleware wrote (`{ state, version }`), so nobody loses a livery.
 */

export type Selector<S, T> = (state: S) => T

export type SelectOptions = {

  /** Call the listener once with the current value on subscribe. */
  fireImmediately?: boolean;
}

export type PersistOptions<S extends object> = {

  /** localStorage key. */
  name:       string;
  version:    number;
  partialize: (state: S) => Partial<S>;

  /** Upgrade a save written under an older `version`. */
  migrate?: (saved: Partial<S>, version: number) => Partial<S>;

  /** Layer the save over the defaults. Shallow merge when omitted. */
  merge?: (saved: Partial<S>, current: S) => S;
}

export interface ClientStore<S extends object> extends Store<S> {

  /** Listen to one slice; fires only when the selected value changes (`Object.is`). */
  select<T>(selector: Selector<S, T>, listener: (value: T, prev: T) => void, options?: SelectOptions): () => void;

  /** Patch from the current state. An empty patch (or the state itself) is a no-op. */
  update(patch: (state: S) => Partial<S>): void;
}

type Envelope<S> = { state: Partial<S>; version: number }

function load<S extends object> (initial: S, options: PersistOptions<S>): S {
  if (typeof window === 'undefined')
    return initial
  try {
    const raw = window.localStorage.getItem(options.name)
    if (!raw)
      return initial

    const envelope = JSON.parse(raw) as Envelope<S>
    let saved      = envelope.state ?? {}
    if (envelope.version !== options.version && options.migrate)
      saved = options.migrate(saved, envelope.version)
    return options.merge ? options.merge(saved, initial) : { ...initial, ...saved }
  }
  catch {
    return initial
  }
}

function save<S extends object> (state: S, options: PersistOptions<S>): void {
  if (typeof window === 'undefined')
    return
  try {
    const envelope: Envelope<S> = { state: options.partialize(state), version: options.version }
    window.localStorage.setItem(options.name, JSON.stringify(envelope))
  }
  catch {
    // Quota exceeded or storage disabled: the session simply does not persist.
  }
}

export function defineStore<S extends object> (initial: S, persist?: PersistOptions<S>): ClientStore<S> {
  const base = createStore<S>(persist ? load(initial, persist) : initial)

  const select = <T>(selector: Selector<S, T>, listener: (value: T, prev: T) => void, options?: SelectOptions) => {
    let prev = selector(base.get())
    if (options?.fireImmediately)
      listener(prev, prev)
    return base.subscribe(state => {
      const next = selector(state)
      if (Object.is(next, prev))
        return

      const last = prev
      prev       = next
      listener(next, last)
    })
  }

  const update = (patch: (state: S) => Partial<S>) => {
    const state = base.get()
    const next  = patch(state)
    if (next === state || Object.keys(next).length === 0)
      return
    base.set(next)
  }

  if (persist)
    base.subscribe(state => save(state, persist))

  return Object.assign(base, { select, update })
}
