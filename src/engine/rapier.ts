import type RAPIER from '@dimforge/rapier3d-compat'


export type Rapier = typeof RAPIER

let pending: Promise<Rapier> | null = null

/**
 * Load and initialise the rapier WASM module, once per page.
 *
 * `@dimforge/rapier3d-compat` needs `await init()` before any `World` exists,
 * which does not fit `createApp`'s synchronous constructor — so the world is
 * built out here and injected, and nothing in a module's `build()` is async.
 *
 * The import is dynamic on purpose: it keeps the base64-inlined WASM payload out
 * of the initial Next chunk and off any server render path. Single-flighting the
 * promise means route changes and React StrictMode double-mounts don't re-decode
 * it.
 */
export function initRapier (): Promise<Rapier> {
  pending ??= import('@dimforge/rapier3d-compat').then(async module => {
    await module.init()
    return module
  })
  return pending
}
