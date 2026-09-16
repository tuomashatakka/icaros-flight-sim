/**
 * The mode-agnostic half of client-side prediction.
 *
 * What is here: the unacknowledged-input ring, the ring of poses this client
 * predicted for those inputs, and the render-offset smoother that decides
 * whether a server correction is ignored, blended, or snapped. What is NOT
 * here: anything that knows how a ship moves. Stepping the physics and reading
 * a snapshot belong to the mode, because those are the parts race and battle
 * genuinely differ on.
 *
 * The tiers are about what the PLAYER sees, not about protecting the solver.
 * They used to be the latter: the ship was a rapier
 * `DynamicRayCastVehicleController` whose per-wheel suspension state could not
 * be snapshotted, so a reset-and-replay never restarted from the server's
 * actual state and correcting thirty times a second fought the controller
 * continuously. That vehicle is gone — a hovercraft's entire state is its body
 * pose and velocity — so a correction now lands exactly, and the only question
 * left is whether the player should be able to see it happen.
 */

import { MAX_INPUT_FRAMES } from './rates'

import type { InputFrame } from './codec/input'


/**
 * Predicted poses kept.
 *
 * Twice the unacknowledged-input cap, because an acknowledgement names a frame
 * that has already left `PendingInputs` — the pose for it has to outlive the
 * input by however long the snapshot carrying the acknowledgement was in
 * flight.
 */
const HISTORY = MAX_INPUT_FRAMES * 2


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

type OutType = { x: number; y: number; z: number }

type FunctionReturnType = { x: number; y: number; z: number }

/**
 * Poses this client predicted, indexed by the input frame that produced them.
 *
 * Reconciliation needs this to ask the only question that means anything: at
 * the tick the server answered for, was the prediction right? The server's
 * snapshot describes `lastProcessedInput`, which is up to a round trip behind
 * the frame the client is drawing. Comparing that pose to the one the client
 * holds NOW measures `speed x round trip` of lag and calls it prediction
 * error — at 50 m/s and 100 ms that is five metres the prediction never got
 * wrong, which is over any sane snap threshold. Every snapshot then "corrects"
 * a prediction that was tracking perfectly.
 *
 * Positions only: the deadband is a distance, and carrying rotations here
 * would double the ring for something nothing reads.
 */
export class PredictedPoses {
  private readonly seqs = new Int32Array(HISTORY)
  private readonly xyz = new Float64Array(HISTORY * 3)
  private head = -1

  /** Store the pose that input frame `seq` integrated to. */
  record (seq: number, x: number, y: number, z: number): void {
    this.head            = (this.head + 1) % HISTORY
    this.seqs[this.head] = seq

    const at         = this.head * 3
    this.xyz[at]     = x
    this.xyz[at + 1] = y
    this.xyz[at + 2] = z
  }

  /**
   * Read back the pose for `seq`, or null when it is no longer held.
   *
   * Null is not an error — it is what a client sees on its first few snapshots,
   * and after a snap threw the history away. The caller falls back to the
   * present pose, which is what this code did unconditionally before.
   */
  find (seq: number, out: OutType): OutType | null {
    if (this.head < 0)
      return null

    for (let step = 0; step < HISTORY; step++) {
      const slot = (this.head - step + HISTORY) % HISTORY
      if (this.seqs[slot] !== seq)
        continue

      const at = slot * 3
      out.x    = this.xyz[at]
      out.y    = this.xyz[at + 1]
      out.z    = this.xyz[at + 2]
      return out
    }
    return null
  }

  /**
   * Forget everything.
   *
   * Called after a correction the replay did NOT follow up — a respawn. The
   * ring then describes a trajectory the body is not on any more, and a stale
   * entry is worse than no entry: it would measure the next snapshot against a
   * pose from before the relocation.
   */
  reset (): void {
    this.head = -1
    this.seqs.fill(0)
  }
}

/**
 * Holds the visible error between where the body is and where it is drawn.
 *
 * The body itself is moved to the authoritative pose immediately; this carries
 * the difference so the RENDER can walk there over a few frames. Extrapolating
 * from the authoritative state rather than from a smoothed fake one is what
 * keeps stacked and colliding bodies stable.
 */
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
