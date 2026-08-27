/**
 * Buffered entity interpolation: the single biggest jitter fix in the netcode
 * plan, and the thing the previous implementation got wrong.
 *
 * That version blended on a free-running accumulator with no relationship to
 * when packets arrived, so remote ships stuttered on a perfectly clean stream.
 * These tests pin the replacement to what it must do: sample at an explicit
 * server time, never blend across a teleport, and refuse to guess too far.
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { NetBodyInterpolator } from 'Δengine/interpolation-network'


const IDENTITY = [ 0, 0, 0, 1 ]

/** A pose at `x` along the X axis, upright. */
const at = (x: number, y = 0, z = 0) => [ x, y, z, ...IDENTITY ]

/** A pose yawed by `angle`, so orientation blending is observable. */
function yawed (x: number, angle: number): number[] {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle)
  return [ x, 0, 0, q.x, q.y, q.z, q.w ]
}

function sample (interp: NetBodyInterpolator, time: number) {
  const position   = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const drew       = interp.sampleAt(time, position, quaternion)
  return { drew, position, quaternion }
}

describe('NetBodyInterpolator', () => {
  it('draws nothing until it has seen a pose', () => {
    // The caller has to be able to hide the ship: a remote nobody has heard
    // from has no position, and (0, 0, 0) is a real place on this map.
    const interp = new NetBodyInterpolator()
    expect(interp.hasPose()).toBe(false)
    expect(sample(interp, 1_000).drew).toBe(false)
  })

  it('holds a single pose rather than interpolating from nothing', () => {
    const interp = new NetBodyInterpolator()
    interp.commit(1_000, at(5))

    expect(sample(interp, 1_000).position.x).toBe(5)
    expect(sample(interp, 900).position.x).toBe(5)
  })

  it('interpolates position between the two snapshots bracketing the time', () => {
    const interp = new NetBodyInterpolator()
    interp.commit(1_000, at(0))
    interp.commit(1_100, at(10))

    expect(sample(interp, 1_000).position.x).toBeCloseTo(0)
    expect(sample(interp, 1_050).position.x).toBeCloseTo(5)
    expect(sample(interp, 1_100).position.x).toBeCloseTo(10)
  })

  it('slerps orientation rather than lerping it', () => {
    const interp = new NetBodyInterpolator()
    interp.commit(1_000, yawed(0, 0))
    interp.commit(1_100, yawed(0, Math.PI / 2))

    const mid   = sample(interp, 1_050).quaternion
    const euler = new THREE.Euler().setFromQuaternion(mid, 'YXZ')
    expect(euler.y).toBeCloseTo(Math.PI / 4, 3)
  })

  it('brackets correctly with more than two poses buffered', () => {
    const interp = new NetBodyInterpolator()
    for (let i = 0; i <= 5; i++)
      interp.commit(1_000 + i * 100, at(i * 10))

    expect(sample(interp, 1_250).position.x).toBeCloseTo(25)
    expect(sample(interp, 1_450).position.x).toBeCloseTo(45)
  })

  it('extrapolates past the newest pose, but only so far', () => {
    const interp = new NetBodyInterpolator()
    interp.commit(1_000, at(0))
    interp.commit(1_100, at(10))

    // 50 ms past the newest at 10 units per 100 ms.
    expect(sample(interp, 1_150).position.x).toBeCloseTo(15)

    // Clamped at 250 ms: unclamped, a badly delayed ship flies through the
    // arena wall instead of appearing to lag.
    expect(sample(interp, 1_350).position.x).toBeCloseTo(35)
    expect(sample(interp, 5_000).position.x).toBeCloseTo(35)
  })

  it('holds heading while extrapolating instead of continuing a spin', () => {
    // A continued angular rate winds a spinning ship somewhere absurd; a
    // slightly stale heading reads far better than a confidently wrong one.
    const interp = new NetBodyInterpolator()
    interp.commit(1_000, yawed(0, 0))
    interp.commit(1_100, yawed(10, Math.PI / 2))

    const ahead = sample(interp, 1_300).quaternion
    const euler = new THREE.Euler().setFromQuaternion(ahead, 'YXZ')
    expect(euler.y).toBeCloseTo(Math.PI / 2, 3)
  })

  it('never blends across a teleport', () => {
    // The bug this exists to prevent: `kill()` relocates a chassis across the
    // arena, and a blend through that draws the ship streaking over the level.
    const interp = new NetBodyInterpolator()
    interp.commit(1_000, at(0))
    interp.commit(1_100, at(10))

    interp.teleport(1_200, at(900))

    expect(sample(interp, 1_150).position.x).toBe(900)
    expect(sample(interp, 1_200).position.x).toBe(900)
    expect(sample(interp, 1_250).position.x).toBe(900)
  })

  it('drops a snapshot that arrives out of order', () => {
    const interp = new NetBodyInterpolator()
    interp.commit(1_000, at(0))
    interp.commit(1_100, at(10))

    // A reordered packet: a later snapshot already superseded it, and inserting
    // it would corrupt the ring's ordering.
    interp.commit(1_050, at(-500))

    expect(sample(interp, 1_050).position.x).toBeCloseTo(5)
    expect(interp.newestTimeMs()).toBe(1_100)
  })

  it('drops a duplicate timestamp', () => {
    const interp = new NetBodyInterpolator()
    interp.commit(1_000, at(0))
    interp.commit(1_000, at(99))

    expect(sample(interp, 1_000).position.x).toBe(0)
  })

  it('holds the oldest pose when the renderer falls behind its history', () => {
    const interp = new NetBodyInterpolator()
    for (let i = 0; i < 12; i++)
      interp.commit(1_000 + i * 100, at(i * 10))

    // Older than anything still buffered. Extrapolating backwards would invent
    // a position the ship was never at.
    const behind = sample(interp, 500)
    expect(behind.drew).toBe(true)
    expect(behind.position.x).toBeGreaterThanOrEqual(0)
  })

  it('keeps working once the ring has wrapped', () => {
    const interp = new NetBodyInterpolator()
    for (let i = 0; i < 40; i++)
      interp.commit(1_000 + i * 100, at(i * 10))

    expect(interp.newestTimeMs()).toBe(1_000 + 39 * 100)
    expect(sample(interp, 1_000 + 38 * 100 + 50).position.x).toBeCloseTo(385)
  })
})
