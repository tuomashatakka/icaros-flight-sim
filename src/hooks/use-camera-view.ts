'use client'

import { create } from 'zustand'
import type { CameraView } from '@/engine/camera/rig'

/**
 * Which camera the race is being watched through.
 *
 * A mirror, not the source of truth: the rig owns the view and the blend, and it
 * is driven straight from `Controls` in the render phase so a toggle never waits
 * on a React commit. This store exists only so the DOM layer can drop
 * chase-only chrome once you are seated — it is written once per TOGGLE, never
 * per frame, which is why the continuous blend is deliberately not in here.
 */
export interface CameraViewState {
  view:    CameraView;
  setView: (view: CameraView) => void;
}

export const useCameraView = create<CameraViewState>()(set => ({
  view:    'chase',
  setView: view => set(state => state.view === view ? state : { view }),
}))
