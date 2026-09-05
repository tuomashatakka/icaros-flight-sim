export type SceneLifecycleState = {
  hidden:        boolean;
  frozen:        boolean;
  offscreen:     boolean;
  paused:        boolean;
  reducedMotion: boolean;
}

const state: SceneLifecycleState = {
  hidden:        false,
  frozen:        false,
  offscreen:     false,
  paused:        false,
  reducedMotion: false,
}

export function sceneLifecycleState (): Readonly<SceneLifecycleState> {
  return state
}

export function publishSceneLifecycle (next: SceneLifecycleState): void {
  Object.assign(state, next)
}

export function reducedMotion (): boolean {
  return state.reducedMotion
}
