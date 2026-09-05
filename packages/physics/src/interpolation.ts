import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-deterministic-compat'

// Hoisted scratch — sample() runs once per rendered frame per body.
const _prevQuat = new THREE.Quaternion()
const _currQuat = new THREE.Quaternion()

/**
 * Render-time interpolation for one rigid body.
 *
 * The sim runs at a fixed 60 Hz but the display may run at 144 Hz, so rendering
 * the raw `body.translation()` stair-steps. `@react-three/rapier`'s `<Physics
 * interpolate>` used to hide this for free; without it we snapshot the pose
 * after every solve and blend between the last two.
 *
 * Poses are held as flat Float64Arrays `[x, y, z, qx, qy, qz, qw]` so a commit
 * is one `.set()` and no objects are allocated per tick.
 */
export class BodyInterpolator {
  private prev = new Float64Array(7)
  private curr = new Float64Array(7)
  private jumped = true

  constructor (private body: RAPIER.RigidBody) {
    // Seed both snapshots with the spawn pose so the first rendered frame has
    // something coherent to blend between.
    this.commit()
    this.commit()
  }

  /** Capture the solved pose. Call exactly once per sim tick, right after `world.step()`. */
  commit (): void {
    this.prev.set(this.curr)

    const t      = this.body.translation()
    const r      = this.body.rotation()
    this.curr[0] = t.x
    this.curr[1] = t.y
    this.curr[2] = t.z
    this.curr[3] = r.x
    this.curr[4] = r.y
    this.curr[5] = r.z
    this.curr[6] = r.w

    // A teleport is a discontinuity, not motion — collapse prev onto curr so no
    // frame ever blends across it. Without this the ship visibly smears from the
    // crash site to the start line on respawn.
    if (this.jumped) {
      this.prev.set(this.curr)
      this.jumped = false
    }
  }

  /** Mark the next commit as a cut. Call right after `setTranslation`/`setRotation`. */
  teleport (): void {
    this.jumped = true
  }

  /**
   * Blend the last two solved poses.
   *
   * @param alpha - From {@link SimClock.alpha}; the fraction of the next step
   * already elapsed in real time.
   */
  sample (alpha: number, outPosition: THREE.Vector3, outQuaternion: THREE.Quaternion): void {
    const p = this.prev
    const c = this.curr

    outPosition.set(
      p[0] + (c[0] - p[0]) * alpha,
      p[1] + (c[1] - p[1]) * alpha,
      p[2] + (c[2] - p[2]) * alpha
    )

    _prevQuat.set(p[3], p[4], p[5], p[6])
    _currQuat.set(c[3], c[4], c[5], c[6])
    outQuaternion.slerpQuaternions(_prevQuat, _currQuat, alpha)
  }
}

// perf: one Float64Array pair per body, two hoisted quaternions total. Sampling
// is allocation-free. Note we render one step (16.7 ms) in the past rather than
// extrapolating — the vehicle controller's contact-driven pose changes direction
// abruptly, and extrapolation makes the ship overshoot visibly into walls.
