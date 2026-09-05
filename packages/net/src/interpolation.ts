import * as THREE from 'three'

// Hoisted scratch for sampling — same allocation-free commitment as the local
// BodyInterpolator.
const _prevQuat = new THREE.Quaternion()
const _currQuat = new THREE.Quaternion()

/**
 * Poses kept per remote body.
 *
 * At 30 Hz this is a quarter-second of history, comfortably more than the
 * 100 ms the renderer sits behind, so a couple of late packets never starve the
 * bracket.
 */
const HISTORY = 8

/**
 * How far past the newest pose extrapolation is allowed to run.
 *
 * Linear extrapolation of a fast-moving ship reads fine for a few frames and
 * then diverges hard — especially through a collision, which it cannot know
 * about. Past this the ship holds its last known pose, which looks like lag;
 * unclamped it would look like the ship flew through the arena wall.
 */
const EXTRAPOLATE_MAX_MS = 250

export type InterpolationSample = {
  mode:        'empty' | 'hold' | 'interpolate' | 'extrapolate' | 'clamped';
  bufferDepth: number;
  aheadMs:     number;
}

/** `[x, y, z, qx, qy, qz, qw]`. */
const STRIDE = 7

/**
 * Render-time interpolation for one remote (networked) body.
 *
 * Holds a short history of TIMESTAMPED poses and samples it at an explicit
 * server time. That timestamp is the whole difference from what this used to
 * be: the previous version blended on a free-running accumulator with no
 * correlation to when packets actually arrived, so every remote ship
 * micro-stuttered no matter how clean the stream was.
 *
 * Poses are flat `[x, y, z, qx, qy, qz, qw]`.
 */
export class NetBodyInterpolator {
  private readonly poses = new Float64Array(HISTORY * STRIDE)
  private readonly times = new Float64Array(HISTORY)

  /** Ring write cursor, and how many slots are live. */
  private head = 0
  private count = 0
  private lastSample: InterpolationSample = { mode: 'empty', bufferDepth: 0, aheadMs: 0 }

  diagnostics (): Readonly<InterpolationSample> {
    return this.lastSample
  }

  /** Newest pose wins ties; a snapshot that repeats a timestamp replaces it. */
  commit (serverTimeMs: number, pose: ArrayLike<number>): void {
    if (this.count > 0 && serverTimeMs <= this.times[this.head])
      // Out of order or duplicate. Dropping it is correct: a later snapshot
      // already superseded it, and inserting would corrupt the ring's ordering.
      return

    this.head             = this.count === 0 ? 0 : (this.head + 1) % HISTORY
    this.times[this.head] = serverTimeMs
    this.poses.set(pose as ArrayLike<number> & number[], this.head * STRIDE)
    this.count = Math.min(HISTORY, this.count + 1)
  }

  /**
   * Discard history and restart from one pose.
   *
   * Used on respawn and on any server-side teleport: without it the ring still
   * holds where the ship was before the jump, and the next sample draws it
   * streaking across the arena to its new position.
   */
  teleport (serverTimeMs: number, pose: ArrayLike<number>): void {
    this.head     = 0
    this.count    = 1
    this.times[0] = serverTimeMs
    this.poses.set(pose as ArrayLike<number> & number[], 0)
  }

  hasPose (): boolean {
    return this.count > 0
  }

  /** Server time of the newest pose held, or 0 when empty. */
  newestTimeMs (): number {
    return this.count > 0 ? this.times[this.head] : 0
  }

  private readPose (slot: number, outPosition: THREE.Vector3, outQuaternion: THREE.Quaternion): void {
    const at = slot * STRIDE
    outPosition.set(this.poses[at], this.poses[at + 1], this.poses[at + 2])
    outQuaternion.set(this.poses[at + 3], this.poses[at + 4], this.poses[at + 5], this.poses[at + 6])
  }

  /**
   * Sample the body as it was at `serverTimeMs`.
   *
   * Returns false when there is nothing to draw yet, so the caller can hide the
   * ship rather than render it at the origin — a remote that has not been seen
   * has no position, and (0, 0, 0) is a real place on this map.
   */
  sampleAt (serverTimeMs: number, outPosition: THREE.Vector3, outQuaternion: THREE.Quaternion): boolean {
    if (this.count === 0) {
      this.lastSample = { mode: 'empty', bufferDepth: 0, aheadMs: 0 }
      return false
    }

    if (this.count === 1) {
      this.lastSample = { mode: 'hold', bufferDepth: 1, aheadMs: Math.max(0, serverTimeMs - this.times[this.head]) }
      this.readPose(this.head, outPosition, outQuaternion)
      return true
    }

    // Walk back from newest to find the pair bracketing the requested time.
    for (let step = 0; step < this.count - 1; step++) {
      const newer = (this.head - step + HISTORY) % HISTORY
      const older = (newer - 1 + HISTORY) % HISTORY

      if (this.times[older] <= serverTimeMs && serverTimeMs <= this.times[newer]) {
        this.lastSample = { mode: 'interpolate', bufferDepth: this.count, aheadMs: 0 }

        const span  = this.times[newer] - this.times[older]
        const alpha = span > 0 ? (serverTimeMs - this.times[older]) / span : 1

        this.readPose(older, outPosition, _prevQuat)
        this.readPose(newer, _tmpPosition, _currQuat)

        outPosition.lerp(_tmpPosition, alpha)
        outQuaternion.slerpQuaternions(_prevQuat, _currQuat, alpha)
        return true
      }
    }

    const newestAt = this.times[this.head]
    if (serverTimeMs > newestAt) {
      const aheadMs   = serverTimeMs - newestAt
      this.lastSample = { mode: aheadMs > EXTRAPOLATE_MAX_MS ? 'clamped' : 'extrapolate', bufferDepth: this.count, aheadMs }
      this.extrapolate(aheadMs, outPosition, outQuaternion)
      return true
    }

    // Older than anything held — the renderer is further behind than the
    // history covers. Hold the oldest pose rather than extrapolating backwards.
    const oldest    = this.count < HISTORY ? 0 : (this.head + 1) % HISTORY
    this.lastSample = { mode: 'hold', bufferDepth: this.count, aheadMs: 0 }
    this.readPose(oldest, outPosition, outQuaternion)
    return true
  }

  /**
   * Continue the last segment's motion, for a clamped moment.
   *
   * Velocity comes from the two newest poses rather than from a transmitted
   * one, so this stays correct if the snapshot ever stops carrying velocity.
   * Orientation is held rather than extrapolated: continuing an angular rate
   * through a clamp window makes a spinning ship wind up somewhere absurd, and
   * a slightly stale heading reads far better than a wrong one.
   */
  private extrapolate (aheadMs: number, outPosition: THREE.Vector3, outQuaternion: THREE.Quaternion): void {
    const newer = this.head
    const older = (this.head - 1 + HISTORY) % HISTORY
    const span  = this.times[newer] - this.times[older]

    this.readPose(newer, outPosition, outQuaternion)
    if (span <= 0)
      return

    this.readPose(older, _tmpPosition, _prevQuat)

    const clamped = Math.min(aheadMs, EXTRAPOLATE_MAX_MS) / span
    _tmpVelocity.copy(outPosition).sub(_tmpPosition)
      .multiplyScalar(clamped)
    outPosition.add(_tmpVelocity)
  }
}

const _tmpPosition = new THREE.Vector3()
const _tmpVelocity = new THREE.Vector3()
