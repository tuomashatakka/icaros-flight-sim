import { defineStore } from './store'
import { INITIAL_CAMERA_VIEW } from './defaults'
import type { CameraView, CameraViewState } from './types'

/**
 * Which camera the race is being watched through.
 *
 * A mirror, not the source of truth: the rig owns the view and the blend, and
 * is driven straight from `Controls` in the render phase so a toggle never
 * waits on a React commit. Written once per TOGGLE, never per frame.
 */
export const cameraViewStore = defineStore<CameraViewState>({ view: INITIAL_CAMERA_VIEW })

export const setCameraView = (view: CameraView): void =>
  cameraViewStore.update(state => state.view === view ? state : { view })
