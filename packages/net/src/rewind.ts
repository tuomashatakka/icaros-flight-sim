/**
 * Lag compensation: a short history of where every ship was.
 *
 * A player shoots at what their screen shows them, and their screen shows the
 * world as it was roughly half a round trip plus the interpolation delay ago.
 * Resolving that shot against the present punishes them for their own latency —
 * the "I shot them dead centre and nothing happened" complaint. So the server
 * keeps a rolling history and rewinds the hitboxes to the tick the shooter was
 * actually looking at before testing the shot. Source calls this favouring the
 * shooter; it is what makes hits feel honest at any ping.
 *
 * The cost is paid by the target: occasionally you take a hit after stepping
 * behind cover, because on the shooter's screen you had not yet. That trade is
 * the standard one, and the clamp below bounds how bad it can get.
 */


// A position in world space. Structural on purpose — rapier's, three's and a
//  plain literal all satisfy it, so this module needs neither as a dependency.
export type Vec3 = { x: number; y: number; z: number }

// The least a rewindable entity has to be. Where it *is* comes from the
//  accessor handed to the constructor, so nothing has to grow a method to be
//  rewindable — and recording stays allocation-free.
export type Rewindable = { id: string }

/**
 * How far back a shot may be rewound, in milliseconds.
 *
 * Covers an interpolation delay (~100 ms) plus half a round trip for anyone on
 * a reasonable connection. Beyond it, the shooter's view is too far from the
 * present for the correction to be fair to the target — Overwatch draws the
 * same line at roughly 220 ms RTT — so the shot resolves against the present
 * instead, and a very laggy player simply has to lead more.
 */
export const MAX_REWIND_MS = 250

/** History kept, in milliseconds. Comfortably more than the clamp uses. */
export const HISTORY_MS = 1000

type Frame = {
  tick:  number;
  ids:   string[];
  poses: number[];
}

export class RewindBuffer<T extends Rewindable> {
  private readonly frames:         Frame[] = []
  private readonly capacity:       number
  private readonly maxRewindTicks: number

  private head = -1
  private count = 0

  constructor (tickHz: number, private readonly poseOf: (entity: T) => Vec3) {
    this.capacity       = Math.max(2, Math.round(HISTORY_MS * tickHz / 1000))
    this.maxRewindTicks = Math.max(1, Math.round(MAX_REWIND_MS * tickHz / 1000))

    for (let i = 0; i < this.capacity; i++)
      this.frames.push({ tick: -1, ids: [], poses: []})
  }

  /**
   * Store this tick's poses.
   *
   * Arrays are reused rather than rebuilt: this runs 60 times a second for the
   * life of every match, and a fresh object per ship per tick is the kind of
   * allocation that turns into a GC pause mid-firefight.
   */
  record (tick: number, players: readonly T[]): void {
    this.head   = (this.head + 1) % this.capacity

    const frame = this.frames[this.head]

    frame.tick         = tick
    frame.ids.length   = players.length
    frame.poses.length = players.length * 3

    for (let i = 0; i < players.length; i++) {
      const t                = this.poseOf(players[i])
      frame.ids[i]           = players[i].id
      frame.poses[i * 3]     = t.x
      frame.poses[i * 3 + 1] = t.y
      frame.poses[i * 3 + 2] = t.z
    }

    this.count = Math.min(this.capacity, this.count + 1)
  }

  /**
   * The tick a shot fired at `requested` should actually resolve against.
   *
   * Clamped at both ends: never into the future (a client claiming to render
   * ahead of the server would otherwise pick a tick that does not exist), and
   * never further back than `MAX_REWIND_MS`.
   */
  resolveTick (requested: number, currentTick: number): number {
    if (!Number.isFinite(requested) || requested <= 0)
      return currentTick

    const clamped = Math.min(requested, currentTick)
    return Math.max(clamped, currentTick - this.maxRewindTicks)
  }

  private frameAt (tick: number): Frame | null {
    for (let step = 0; step < this.count; step++) {
      const frame = this.frames[(this.head - step + this.capacity) % this.capacity]
      if (frame.tick === tick)
        return frame
    }
    return null
  }

  /**
   * A pose source resolving every ship as of `tick`.
   *
   * Returns null when that tick is no longer held, so the caller falls back to
   * live poses rather than to a silently wrong history — a shot resolved
   * against the present is merely unkind to a laggy shooter, one resolved
   * against the wrong tick is a bug nobody can see.
   *
   * A ship absent from the frame (it joined after) also falls back to live: it
   * was not on the shooter's screen either, and refusing to place it at all
   * would make it unhittable.
   */
  poseSourceAt (tick: number): ((player: T) => Vec3) | null {
    const frame = this.frameAt(tick)
    if (!frame)
      return null

    return player => {
      const index = frame.ids.indexOf(player.id)
      if (index < 0) {
        const t = this.poseOf(player)
        return { x: t.x, y: t.y, z: t.z }
      }

      return {
        x: frame.poses[index * 3],
        y: frame.poses[index * 3 + 1],
        z: frame.poses[index * 3 + 2],
      }
    }
  }

  /** Ticks currently held, for `/health` and tests. */
  get depth (): number {
    return this.count
  }
}
