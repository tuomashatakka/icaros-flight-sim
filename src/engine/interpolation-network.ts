import * as THREE from 'three'

// Hoisted scratch for sampling — same allocation-free commitment as the local
// BodyInterpolator.
const _prevQuat = new THREE.Quaternion()
const _currQuat = new THREE.Quaternion()

/**
 * Render-time interpolation for one remote (networked) body.
 *
 * The battle server broadcasts 30 Hz snapshots, so a raw replay of latest-wins
 * poses stair-steps hard against a 60+ Hz render loop. This holds the last two
 * received poses and blends between them on an alpha supplied by the caller —
 * the battle scene feeds it `frame`-based time so motion reads continuous.
 *
 * Poses are flat Float64Arrays `[x, y, z, qx, qy, qz, qw]`; a commit is one
 * `.set()`.
 */
export class NetBodyInterpolator {
  private prev = new Float64Array(7)
  private curr = new Float64Array(7)
  private empty = true

  /** Replace the newest pose, sliding the previous one back. */
  commit (pose: Float64Array | number[]): void {
    if (!this.empty) {
      this.prev.set(this.curr)
      this.curr.set(pose)
    }
    else {
      this.curr.set(pose)
      this.empty = false
    }
  }

  /** Snap both slots to a pose — use on teleport/respawn so nothing blends across it. */
  teleport (pose: Float64Array | number[]): void {
    this.curr.set(pose)
    this.prev.set(pose)
    this.empty = false
  }

  hasPose (): boolean {
    return !this.empty
  }

  sample (alpha: number, outPosition: THREE.Vector3, outQuaternion: THREE.Quaternion): void {
    if (this.empty)
      return

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

/**
 * The scene-wide net clock: an accumulator advanced by real frame delta, whose
 * fraction-of-packet tells every interpolator how far between the last two
 * snapshots it should blend. Stateless across jittery packet timing — a 33 ms
 * slide is far cheaper than exactly correlating arrivals to ticks.
 */
export class NetworkClock {
  private t = 0

  // Hard-coded interval between snapshots, in seconds. Keep in sync with the
  //  server's `STATE_EVERY=2` at a 60 Hz step.
  private readonly packetSeconds = 2 / 60

  tick (delta: number): number {
    this.t %= this.packetSeconds

    const alpha = this.t / this.packetSeconds
    this.t += delta
    return alpha
  }
}
