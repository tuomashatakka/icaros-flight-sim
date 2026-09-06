/**
 * The arena's grade, over the shared chain.
 *
 * Everything that used to be here — the pass list, the flash decay, the speed
 * streak, the quality ladder — moved to `render/post.ts`, because race had none
 * of it and the two modes did not look like the same game. What is left is the
 * part that is genuinely battle's: a cooler, more contrasted grade than the
 * track gets, and the names the arena calls it by.
 */

import { createScenePost, resolveQuality } from '../render/post'
import type { PostQuality, ScenePostHandle } from '../render/post'


export type { PostQuality } from '../render/post'
export { resolveQuality } from '../render/post'

export type BattlePostHandle = ScenePostHandle & {

  /** 0..1 — how hard the frame streaks outward. Ramped from ground speed. */
  setSpeed(speed: number): void;
}

export function createBattlePost (quality: PostQuality = resolveQuality()): BattlePostHandle {
  const post = createScenePost({
    tint:       '#e8eeff',
    contrast:   1.02,
    saturation: 1.07,
    vignette:   0.28,
    quality,
  })

  let speed = 0

  return {
    ...post,

    // Kept because the arena drives speed from its own transport frame rather
    // than from telemetry, and it has no acceleration figure to pair with it.
    setSpeed (value) {
      speed = value
      post.setMotion(speed, 0)
    },

    setMotion (nextSpeed, accel) {
      speed = nextSpeed
      post.setMotion(nextSpeed, accel)
    },
  }
}
