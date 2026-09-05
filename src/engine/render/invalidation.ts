import type { Controls } from '../input'


export type PublishedControls = Readonly<Pick<Controls,
  'steer' | 'throttle' | 'brake' | 'boost' | 'reverse' | 'strafe' | 'resetSeq'>>

export function snapshotPublishedControls (controls: Controls): PublishedControls {
  return Object.freeze({
    steer:    controls.steer,
    throttle: controls.throttle,
    brake:    controls.brake,
    boost:    controls.boost,
    reverse:  controls.reverse,
    strafe:   controls.strafe,
    resetSeq: controls.resetSeq,
  })
}

export function publishedControlsChanged (before: PublishedControls, after: PublishedControls): boolean {
  return before.steer !== after.steer ||
    before.throttle !== after.throttle ||
    before.brake !== after.brake ||
    before.boost !== after.boost ||
    before.reverse !== after.reverse ||
    before.strafe !== after.strafe ||
    before.resetSeq !== after.resetSeq
}

export function changedBeyond (before: number, after: number, epsilon: number): boolean {
  return !Number.isFinite(before) || Math.abs(before - after) > epsilon
}
