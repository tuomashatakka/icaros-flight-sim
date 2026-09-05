/**
 * The mode-agnostic half of client-side prediction.
 *
 * What is here: the unacknowledged-input ring, and the render-offset smoother
 * that decides whether a server correction is ignored, blended, or snapped.
 * What is NOT here: anything that knows how a ship moves. Stepping the physics
 * and reading a snapshot belong to the mode, because those are the parts race
 * and battle genuinely differ on.
 *
 * The three tiers are not a style choice. Rapier's controllers keep internal
 * per-contact state they do not expose for snapshotting, so a replay after a
 * hard reset restarts from a state close to — but not — the server's.
 * Correcting thirty times a second therefore fights the solver continuously and
 * produces exactly the shimmer prediction exists to prevent.
 */

import { MAX_INPUT_FRAMES } from './rates'

import type { InputFrame } from './codec/input'


/**
 * Frames the server has not acknowledged yet.
 *
 * Every input packet sends all of them. That is the whole loss-recovery
 * strategy, and it is why nothing here tracks which frames were "sent".
 */
export class PendingInputs {
  private frames: InputFrame[] = []
  private nextSeq = 0

  // Stamps and stores a frame. The returned object is the one to predict with,
  //  so the frame the client simulated is bit-identical to the one it sends.
  push (frame: Omit<InputFrame, 'seq'>): InputFrame {
    const stamped: InputFrame = { ...frame, seq: ++this.nextSeq }

    this.frames.push(stamped)

    // Dropping the OLDEST is right: it is the one most likely already applied,
    // and the newest is the one the player can feel.
    if (this.frames.length > MAX_INPUT_FRAMES)
      this.frames.shift()

    return stamped
  }

  /** Discard everything the server says it has applied. */
  acknowledge (lastProcessedInput: number): void {
    while (this.frames.length > 0 && this.frames[0].seq <= lastProcessedInput)
      this.frames.shift()
  }

  get all (): readonly InputFrame[] {
    return this.frames
  }

  get length (): number {
    return this.frames.length
  }

  get seq (): number {
    return this.nextSeq
  }

  reset (): void {
    this.frames  = []
    this.nextSeq = 0
  }
}


export type SmoothingConfig = {

  // Metres of position error tolerated before the body is touched at all.
  //  Below this the prediction is tracking, and a correction costs more in
  //  disturbed solver state than it buys.
  deadband: number;

  /** Above this, continuity is a fiction: snap everything, blend nothing. */
  hardSnap: number;

  // Render-offset decay. ~0.12 s to fall to a tenth, so a correction is felt
  //  as a settle rather than seen as a jump.
  halfLife: number;
}

export const DEFAULT_SMOOTHING: SmoothingConfig = { deadband: 0.35, hardSnap: 3, halfLife: 0.055 }

export type CorrectionTier = 'none' | 'blend' | 'snap'

export type Correction = {
  tier:     CorrectionTier;
  distance: number;
}

/**
 * Holds the visible error between where the body is and where it is drawn.
 *
 * The body itself is moved to the authoritative pose immediately; this carries
 * the difference so the RENDER can walk there over a few frames. Extrapolating
 * from the authoritative state rather than from a smoothed fake one is what
 * keeps stacked and colliding bodies stable.
 */
type OutType = { x: number; y: number; z: number }

type FunctionReturnType = { x: number; y: number; z: number }

export class ErrorSmoother {
  private ox = 0
  private oy = 0
  private oz = 0

  constructor (private readonly config: SmoothingConfig = DEFAULT_SMOOTHING) {}

  /**
   * Classify an error, and absorb it if it is being blended.
   *
   * `teleported` forces the snap tier regardless of distance: a respawn that
   * happens to land nearby is still a relocation, and blending across one draws
   * a ship streaking over the arena.
   */
  classify (distance: number, teleported: boolean): Correction {
    if (teleported)
      return { tier: 'snap', distance }

    if (distance <= this.config.deadband)
      return { tier: 'none', distance }

    return { tier: distance > this.config.hardSnap ? 'snap' : 'blend', distance }
  }

  /** Record the jump the body just made, so the render can lag behind it. */
  absorb (dx: number, dy: number, dz: number): void {
    this.ox += dx
    this.oy += dy
    this.oz += dz
  }

  clear (): void {
    this.ox = 0
    this.oy = 0
    this.oz = 0
  }

  /** Decay and read. Returns the offset to ADD to the body's pose when drawing. */
  sample (dt: number, out: OutType): FunctionReturnType {
    const decay = Math.pow(0.5, dt / this.config.halfLife)

    this.ox *= decay
    this.oy *= decay
    this.oz *= decay

    // Below a millimetre it is not visible and the multiply is just work.
    if (Math.abs(this.ox) + Math.abs(this.oy) + Math.abs(this.oz) < 1e-3)
      this.clear()

    out.x = this.ox
    out.y = this.oy
    out.z = this.oz
    return out
  }

  get magnitude (): number {
    return Math.sqrt(this.ox * this.ox + this.oy * this.oy + this.oz * this.oz)
  }
}
