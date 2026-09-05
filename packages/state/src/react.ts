'use client'

import { useSyncExternalStore } from 'react'
import type { ClientStore } from './store'


const identity = <S>(state: S): S => state

/**
 * Read a store from React. Select a primitive or a value the store holds by
 * reference — a selector that builds a fresh object every call never settles.
 */
export function useStoreState<S extends object, T = S> (
  store: ClientStore<S>,
  selector: (state: S) => T = identity as (state: S) => T
): T {
  const read = () => selector(store.get())
  return useSyncExternalStore(store.subscribe, read, read)
}
