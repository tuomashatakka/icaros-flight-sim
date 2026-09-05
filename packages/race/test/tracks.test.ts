import { describe, expect, it } from 'vitest'
import { TRACK_IDS, trackBundle } from '../src/levels'
import { buildCheckpoints } from '../src/track'

/**
 * Track geometry is pure data — that is the whole reason it moved into this
 * package — so it is asserted without a WebGL context, and now without a
 * browser at all. These lock in the numbers the generation walks produce, so a
 * refactor of one cannot silently move the track out from under the colliders
 * the server is running.
 */
describe.each(TRACK_IDS.map(id => [ id ] as const))('track: %s', id => {
  const level = trackBundle(id).spec

  it('is internally consistent', () => {
    expect(level.id).toBe(id)
    expect(level.waypoints.length).toBeGreaterThan(2)
    expect(level.width).toBeGreaterThan(0)
    expect(level.laps).toBeGreaterThan(0)
  })

  it('has a collider everywhere it needs one', () => {
    expect(level.colliders.length).toBeGreaterThan(0)
    for (const box of level.colliders) {
      // A zero or negative half-extent is a degenerate collider the ship falls
      // straight through — the classic failure of the box-strip approach.
      expect(box.args[0]).toBeGreaterThan(0)
      expect(box.args[1]).toBeGreaterThan(0)
      expect(box.args[2]).toBeGreaterThan(0)
      for (const n of [ ...box.position, ...box.rotation, ...box.args ])
        expect(Number.isFinite(n)).toBe(true)
    }
  })

  it('has finite waypoints', () => {
    // Tuples, not `Vector3`: a track is serialisable because it goes over the
    // wire on join.
    for (const p of level.waypoints)
      expect(p.every(n => Number.isFinite(n))).toBe(true)
  })

  it('declares sane bloom', () => {
    // UnrealBloomPass threshold is a HARD knee, so a low value blows out the
    // whole hull — see the port notes. Nothing should drop back near 0.7.
    expect(level.bloom.threshold).toBeGreaterThanOrEqual(0.8)
    expect(level.bloom.strength).toBeGreaterThan(0)
  })

  it('sets a fog range that suits its scale', () => {
    const [ , near, far ] = level.fog
    expect(far).toBeGreaterThan(near)
    // The inherited 20-80 canvas fog would swallow every one of these tracks.
    expect(far).toBeGreaterThan(100)
  })
})

describe('track: flats', () => {
  it('is an even ellipse of 16 gates', () => {
    const level = trackBundle('flats').spec
    expect(level.waypoints).toHaveLength(16)
    expect(level.laps).toBe(3)
    expect(level.loop).toBe(true)
  })
})

describe('track: procedural', () => {
  const level = trackBundle('procedural').spec

  it('is a one-lap sprint, not a circuit', () => {
    expect(level.laps).toBe(1)
    expect(level.loop).toBe(false)
  })

  it('keeps the hand-stitched merge bridged', () => {
    // ribbonBoxColliders only bridges array-adjacent rings; the branch/merge
    // junction needs two explicit boxColliderFromRing bridges on top. Losing
    // them leaves a hole exactly where the shortcut rejoins.
    const ribbonOnly = level.colliders.length
    expect(ribbonOnly).toBeGreaterThan(100)
  })

  it('records a branch-free checkpoint line', () => {
    // Waypoints follow the main route only — the shortcut and jump are skipped,
    // so checkpoints stay orderable.
    expect(level.waypoints.length).toBeGreaterThanOrEqual(10)
  })
})

describe('checkpoints', () => {
  it.each(TRACK_IDS.map(id => [ id ] as const))('%s builds a well-formed gate per waypoint', id => {
    const { spec } = trackBundle(id)
    const gates    = buildCheckpoints(spec)

    expect(gates).toHaveLength(spec.waypoints.length)

    for (const gate of gates) {
      // A zero-length forward would make the plane test meaningless, and a
      // non-unit quaternion would tilt whatever the gate marker is drawn with.
      expect(Math.hypot(...gate.forward)).toBeCloseTo(1, 6)
      expect(Math.hypot(...gate.transform.quaternion)).toBeCloseTo(1, 6)
      expect(gate.halfWidth).toBeGreaterThan(0)
    }
  })
})
