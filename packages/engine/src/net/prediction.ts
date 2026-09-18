/**
 * Client-side prediction and reconciliation for the local ship.
 *
 * Shared by race and battle. Both run the SAME `stepHovercraft` the server
 * does, at the same `STEP`, on their own rapier body — so neither mode's
 * controls wait a round trip, and both correct against the same three tiers.
 *
 * The local player must not wait a round trip to see their own controls
 * respond, so the client runs `stepHovercraft` — the SAME handling authority
 * the server runs, at the same `STEP` — on its own rapier body, and corrects
 * that body when the server disagrees.
 *
 * Reconciliation is a rewind and replay, and there are three parts to it that
 * each fail silently on their own:
 *
 * 1. **The error is measured at the tick the server answered for.** A snapshot
 *    describes `lastProcessedInput`, which is a round trip old. Measuring
 *    against the pose the client holds NOW reads `speed x round trip` as
 *    prediction error — metres of it at racing speed — so the deadband is
 *    blown on every single snapshot no matter how well the prediction tracks.
 * 2. **The rewind restores velocity, not just pose.** `ShipState` carries
 *    `vx…wz`; a reset that zeroes them instead leaves the ship at a standstill
 *    at a stale pose, and nothing but the next correction ever moves it again.
 * 3. **The replay integrates.** `step` only applies forces — `world.step()`
 *    lives in `physicsStepModule` — so replaying N frames without stepping
 *    between them leaves one frame's forces on a body that never moved.
 *
 * Get any of the three wrong and the prediction cannot converge on the pose it
 * was just corrected to, so it is corrected again on the next snapshot, and
 * the ship visibly steps forward thirty times a second. That was the bug.
 *
 * The tiers then decide only what the player is allowed to see:
 *
 *   · under `DEADBAND`  — leave the body alone. The prediction is tracking.
 *   · under `HARD_SNAP` — rewind, replay, and absorb the visible jump into a
 *                         decaying render offset, so it reads as a settle.
 *   · over  `HARD_SNAP` — a genuine desync. Rewind and replay, but draw it
 *                         immediately: past three metres, pretending the ship
 *                         walked there is a worse lie than the cut.
 *   · a respawn         — signalled by `respawnIndex`, never inferred. Snap to
 *                         the server pose and replay NOTHING: the input the
 *                         player was holding was for a ship that no longer
 *                         exists where it was.
 */

import { Vector3 } from 'three'
import { STEP } from 'Φclock'
import { stepHovercraft } from 'Φvehicle-step'
import type { BodyInterpolator } from 'Φinterpolation'
import { MAIN_THRUST_CAPACITY } from 'Φthrusters'
import type { VehicleDebug } from '../vehicle'


const COLLECT_FORCES = process.env.NODE_ENV !== 'production'
import { DEFAULT_SMOOTHING } from 'Ξ'
import { vehicleConfig } from 'Φconfig'
import { DEFAULT_TUNING } from 'Ƨ'
import { AIM_MAX, AIM_RATE } from 'Λ'
import type { Transform } from 'Φtypes'
import type { HovercraftState } from 'Φvehicle-step'

import { ErrorSmoother, PredictedPoses } from 'Ξ'
import type { CorrectionTier, InputFrame } from 'Ξ'
import type RAPIER from '@dimforge/rapier3d-deterministic-compat'


/**
 * Position error tolerated before the body is touched at all, metres.
 *
 * Below this the prediction is tracking, and a rewind costs a handful of
 * `world.step()` calls for a pose nobody could see moving. `DEFAULT_SMOOTHING`
 * carries this, the snap threshold and the offset half-life together in
 * `packages/net`, so the client and the architecture document cannot drift.
 */
const SMOOTHING = DEFAULT_SMOOTHING

/** Per-tick blend for the g meter. ~0.35 s to settle at 60 Hz. */
const G_SMOOTHING = 0.05

/** Trim divergence tolerated before the reticle is pulled to the server's. */
const AIM_EPSILON = 0.02

/**
 * Aim trim bounds. Duplicated from the sims rather than imported from one of
 * them, because importing battle's would make race's prediction depend on
 * battle — and the two agree by construction: one wire format, one ±1 range.
 */
// The aim envelope is the race sim's; declared once there so a client cannot
// predict a different trim than the server integrates.
export { AIM_MAX, AIM_RATE }

/**
 * What the prediction needs from a control frame. Structural, so both
 * `BattleInput` and `RaceInput` satisfy it without either package knowing.
 */
export type PredictInput = {
  steer:     number;
  throttle:  boolean;
  brake:     boolean;
  boost:     boolean;
  reverse?:  boolean;
  strafe?:   number;
  fire?:     boolean;
  aimPitch?: number;
  resetSeq:  number;
}

/**
 * What it needs back from the server. Both modes' merged views satisfy it.
 *
 * The velocities are not optional decoration. `ShipState` has carried `vx…wz`
 * since the bit-packed codec replaced the JSON snapshot, precisely so a
 * receiver never has to finite-difference two poses — and a rewind that
 * restores pose but not velocity puts the predicted ship at a dead stop on
 * every correction.
 */
export type ServerPose = {
  x:            number;
  y:            number;
  z:            number;
  qx:           number;
  qy:           number;
  qz:           number;
  qw:           number;
  vx:           number;
  vy:           number;
  vz:           number;
  wx:           number;
  wy:           number;
  wz:           number;
  aimAngle:     number;
  boost:        number;
  respawnIndex: number;
}

export type PredictionRig = {
  chassis: RAPIER.RigidBody;
  world:   RAPIER.World;
  state:   HovercraftState;

  /**
   * The render's view of `chassis`.
   *
   * Reconciliation owns this rather than the caller, because a correction is
   * three things that are only correct together: move the body, cut the
   * interpolator, and hand the difference to the render offset. Split across
   * two files, they drift — which is how the offset came to be measured
   * against the body's pose while the interpolator was drawing a step behind
   * it, and how the cut came to happen on hard snaps only.
   */
  interpolator: BodyInterpolator;
}

export type PredictionResult = {

  /**
   * How far the body was moved, metres — zero inside the deadband.
   *
   * The distance the prediction was out BY is now measured at the acknowledged
   * tick and so is a live, always-nonzero number; reporting that instead would
   * push a new value into `setNetStats` thirty times a second and force a React
   * commit with it, which is exactly what that setter's tolerance exists to
   * prevent. What the HUD's meter means is how hard the link is correcting, and
   * inside the deadband the answer is "not at all".
   */
  correctionM: number;

  /**
   * What was done about it.
   *
   * `'none'` left the body alone. `'blend'` moved it and handed the difference
   * to the render offset. `'snap'` moved it and drew it there at once. The
   * interpolator is cut either way, by `reconcile` itself; all a correction
   * asks of the caller is a camera cut, and only on `'snap'`.
   */
  tier: CorrectionTier;
}

/** Everything one reconciliation needs, named — it is five things now. */
export type ReconcileParams = {

  /** The authoritative pose, off the newest snapshot. */
  server: ServerPose;

  // The input frame that pose accounts for (`lastProcessedInput`). This is the
  //  join between a snapshot and this client's own prediction history, and
  //  without it there is no way to ask whether the prediction was right.
  ack: number;

  /** Frames the server has not seen yet, oldest first. */
  replay: readonly InputFrame[];

  /** The mode's own frame converter — the same one the server applies. */
  toInput: (frame: InputFrame) => PredictInput;

  spawn:      Transform;
  allowDrive: boolean;
}

const _serverPos    = new Vector3()
const _bodyPos      = new Vector3()
const _predictedPos = new Vector3()
const _beforePos    = new Vector3()

/**
 * One reconciliation's replay burst, measured rather than capped.
 *
 * The report weighed shrinking `MAX_INPUT_FRAMES` against the rare
 * synchronous hitch a bad-RTT correction can cause, and rejected it: a
 * smaller cap trades that rare hitch for common, visible under-correction on
 * the very next snapshot. This is the visibility half of that trade —
 * `bursts`/`lastFrames`/`maxFrames` show how often and how far a correction
 * has to replay, `lastMs`/`maxMs`/`totalMs` how long it cost — so the spike
 * shows up in `dev:console` / `__dev.probe()` instead of being inferred from
 * a dropped frame.
 */
export type ReplayStats = {
  bursts:     number;
  lastFrames: number;
  lastMs:     number;
  maxFrames:  number;
  maxMs:      number;
  totalMs:    number;
}

// Dev-only escape hatch for `__dev.probe()`. `VehicleHandle` (in
// `packages/engine/src/vehicle.ts`) only exposes `debug`, and threading a new
// field through it and every mode's composition root just to reach a counter
// object is a lot of plumbing for something the harness only ever reads. There
// is exactly one `LocalPrediction` alive in a client at a time — one rapier
// world, one predicted chassis, per the module doc above — so the most
// recently constructed instance IS "the" prediction, the same way
// `readHudPanelMetrics` in `hud/panel.ts` reads a module-level aggregate
// rather than being threaded through every caller that builds a panel.

export function readPredictionReplayStats (): ReplayStats | null {
  return LocalPrediction.active?.replayStats() ?? null
}

export class LocalPrediction {
  readonly rig: PredictionRig

  // Difference between where the ship was drawn and where it now is, decayed
  //  to zero over a few frames so a correction never reads as a jump.
  private readonly smoother = new ErrorSmoother(SMOOTHING)

  /** Where this client thought it was, per input frame. See `reconcile`. */
  private readonly history = new PredictedPoses()

  /** The frame whose forces the caller's `world.step()` is about to integrate. */
  private steppedSeq = 0

  private boostMeter = 1
  private groundedNow = false
  private airbrakeNow = 0
  private debugNow:    VehicleDebug | null = null
  private thrustNow = 0
  private gLoadNow = 0
  private aimAngle = 0
  private lastResetSeq = 0
  private respawnSeen: number | null = null

  /**
   * The replay burst behind the last few corrections, updated in place.
   *
   * Two `performance.now()` calls per correction — up to 30 Hz, and usually
   * far less, since a correction only fires outside the deadband — is cheap
   * enough that this needs no `NODE_ENV` gate, unlike `COLLECT_FORCES` above.
   * Nothing here is ever reset automatically: a dev session wants the
   * SESSION's worst burst, not one counter that quietly clears itself.
   */
  /** The live prediction, for the dev harness; the constructor claims it. */
  static active: LocalPrediction | null = null

  private readonly replayStatsData: ReplayStats = {
    bursts:     0,
    lastFrames: 0,
    lastMs:     0,
    maxFrames:  0,
    maxMs:      0,
    totalMs:    0,
  }

  constructor (rig: PredictionRig) {
    this.rig = rig
    LocalPrediction.active = this
  }

  /** The current replay-burst stats. See `replayInput` and `ReplayStats`. */
  replayStats (): ReplayStats {
    return this.replayStatsData
  }

  get boost (): number {
    return this.boostMeter
  }

  /**
   * Hover-pad contact from the last predicted step.
   *
   * Read off the step result rather than probed off the body, because there is
   * no vehicle controller to ask any more — the four hover rays are cast inside
   * `stepHovercraft` and nothing else re-casts them.
   */
  get grounded (): boolean {
    return this.groundedNow
  }

  /** Air-brake deployment 0..1, for the wing panels. */
  get airbrake (): number {
    return this.airbrakeNow
  }

  /** Main-nozzle command as a fraction of the rig's capacity, for the throttle bar. */
  get thrustCommand (): number {
    return this.thrustNow
  }

  /**
   * Airframe load in g, smoothed.
   *
   * Applied force over weight — the number a g meter shows. Smoothed because a
   * contact impulse spikes it for a single tick and an unfiltered needle reads
   * as noise rather than as load.
   */
  get gLoad (): number {
    return this.gLoadNow
  }

  /**
   * The same debug payload the race scene publishes, off the predicted step.
   *
   * Battle draws the identical force overlay as race — the local ship really is
   * running the same `stepHovercraft`, so there is no reason for the two modes
   * to disagree about what a debug layer shows.
   */
  get debug (): VehicleDebug | null {
    return this.debugNow
  }

  /** Predicted vertical trim, normalised to −1..1 for the HUD and the hull. */
  get aimNormalised (): number {
    return this.aimAngle / AIM_MAX
  }

  /**
   * Advance the prediction one fixed tick.
   *
   * `spawn` is only consulted when the input asks for a respawn, which is why
   * the caller can pass its best guess rather than the authoritative lane —
   * the server's answer arrives in the next snapshot and corrects it.
   *
   * `seq` is the input frame's sequence number, and it is what lets
   * reconciliation compare like with like later. Nothing here steps the world:
   * `physicsStepModule` does that, after every module has had its say, because
   * a force applied after `world.step()` silently does nothing for a tick.
   * Which is exactly why the pose recorded below is recorded on ENTRY — at
   * this point the body holds the solved result of the previous frame's
   * forces, so it is that frame's pose, not this one's.
   */
  step (input: PredictInput, spawn: Transform, allowDrive: boolean, seq = 0): void {
    if (this.steppedSeq > 0) {
      const settled = this.rig.chassis.translation()
      this.history.record(this.steppedSeq, settled.x, settled.y, settled.z)
    }
    this.steppedSeq = seq

    let resetRequested = false
    if (input.resetSeq !== this.lastResetSeq) {
      this.lastResetSeq = input.resetSeq
      resetRequested    = true
    }

    // Integrated from the held axis exactly as the sim does it, or the reticle
    // would lag the round trip. The clamp and the respawn reset match too.
    if (resetRequested)
      this.aimAngle = 0
    else if (input.aimPitch)
      this.aimAngle = Math.max(-AIM_MAX, Math.min(AIM_MAX, this.aimAngle + input.aimPitch * AIM_RATE * STEP))

    const out = stepHovercraft({
      chassis:       this.rig.chassis,
      world:         this.rig.world,
      input,
      tuning:        DEFAULT_TUNING,
      state:         this.rig.state,
      dt:            STEP,
      allowDrive,
      spawn,
      resetRequested,
      boostMeter:    this.boostMeter,
      targetSpeed:   vehicleConfig.maxSpeed,
      collectForces: COLLECT_FORCES,
    })

    this.boostMeter  = out.boostMeter
    this.groundedNow = out.grounded
    this.airbrakeNow = out.airbrake
    this.thrustNow   = Math.min(1, out.engineForce / MAIN_THRUST_CAPACITY)

    const [ fx, fy, fz ] = out.netForce
    const g              = Math.hypot(fx, fy, fz) / (vehicleConfig.mass * 9.81)
    this.gLoadNow       += (g - this.gLoadNow) * G_SMOOTHING
    this.debugNow    = COLLECT_FORCES
      ? {
        racing:       allowDrive,
        engineForce:  out.engineForce,
        currentSpeed: out.speed,
        targetSpeed:  vehicleConfig.maxSpeed,
        contacts:     out.contacts,
        dt:           STEP,
        forces:       out.forces,
        netForce:     out.netForce,
        netTorque:    out.netTorque,
      }
      : null
  }

  /**
   * Fold in one authoritative snapshot, replaying whatever input it has not
   * seen yet.
   *
   * The error is measured between the server's pose and the pose this client
   * predicted for `ack` — the same moment, from both sides. Measuring against
   * the body's CURRENT pose instead reads the round trip as error: at 50 m/s
   * and a 100 ms round trip that is five metres of lag the prediction never
   * got wrong, which is past `hardSnap`, so every snapshot snaps.
   */
  reconcile ({ server, ack, replay, toInput, spawn, allowDrive }: ReconcileParams): PredictionResult {
    const body = this.rig.chassis

    _serverPos.set(server.x, server.y, server.z)

    const respawn    = this.respawnSeen !== null && this.respawnSeen !== server.respawnIndex
    this.respawnSeen = server.respawnIndex

    if (Math.abs(this.aimAngle - server.aimAngle) > AIM_EPSILON)
      this.aimAngle = server.aimAngle

    this.boostMeter = server.boost

    // No record for `ack` means the history cannot answer — the first snapshots
    // after a join, or the first after a snap cleared it. The present pose is
    // the only reading available, which is what this used unconditionally
    // before, and it errs towards correcting.
    const t         = body.translation()
    const predicted = this.history.find(ack, _predictedPos) ?? _bodyPos.set(t.x, t.y, t.z)
    const error     = _serverPos.distanceTo(predicted)

    const { tier } = this.smoother.classify(error, respawn)
    if (tier === 'none')
      return { correctionM: 0, tier }

    // Where the ship is being DRAWN from, before anything moves — which is a
    // step behind the body, because that is what render interpolation is.
    this.rig.interpolator.drawnPosition(_beforePos)

    this.applyServerPose(server)

    // A respawn replays nothing: the input the player was holding was for a
    // ship that no longer exists where it was. Everything else replays, snap
    // included — a desync is still a disagreement about where the ship is NOW,
    // and leaving the body a round trip behind guarantees the next snapshot
    // disagrees just as hard.
    if (respawn)
      // The ring now describes a trajectory the body is not on. A stale entry
      // is worse than none: it would measure the next snapshot against a pose
      // from before the relocation.
      this.history.reset()
    else
      this.replayInput(replay, toInput, spawn, allowDrive)

    // The body's track is discontinuous now, so the blend across the cut has to
    // go: `prev` is a pose from a trajectory the ship is not on any more.
    this.rig.interpolator.teleport()

    const settled = body.translation()
    if (tier === 'blend')
      // Hand the jump to the render, which walks it off over ~0.2 s. With the
      // blend collapsed, this offset is the ONLY thing carrying visual
      // continuity across the cut — so it is the drawn/corrected delta, not
      // the raw server-versus-prediction error, which is measured at a
      // different tick and which the replay has since moved on from.
      //
      // `absorb` accumulates rather than assigns, which is what makes a
      // correction landing on top of a still-decaying one come out right.
      this.smoother.absorb(
        _beforePos.x - settled.x,
        _beforePos.y - settled.y,
        _beforePos.z - settled.z
      )
    else {
      this.smoother.clear()
      this.rig.state.smoothedYawRate = 0
      this.rig.state.prevSpeed       = 0
    }

    return { correctionM: error, tier }
  }

  /**
   * Re-simulate the frames the server has not answered for yet.
   *
   * Every frame goes through the SAME converter the server applies frames
   * with — the mode passes it in — so a re-simulated tick is bit-identical to
   * the one being corrected against.
   *
   * Each replayed frame is INTEGRATED. `step` only applies forces, because
   * `world.step()` belongs to `physicsStepModule` and runs once all the
   * modules have had their say; replaying N frames without stepping in between
   * therefore leaves ONE frame's forces standing on a body that never moved,
   * which is a prediction that can never converge on the pose it was just
   * corrected to. There is exactly one dynamic body in this world — remote
   * ships are interpolated transforms with no physics — so stepping it here
   * moves nothing but the ship being replayed.
   */
  private replayInput (
    replay: readonly InputFrame[],
    toInput: (frame: InputFrame) => PredictInput,
    spawn: Transform,
    allowDrive: boolean,
  ): void {
    // Timed unconditionally rather than past some frame-count threshold: a
    // burst this small is exactly the steady-state case R4 measured against,
    // and `bursts`/`totalMs` need every one of them counted for a mean to mean
    // anything.
    const startedAt = performance.now()

    for (let i = 0; i < replay.length; i++) {
      const frame = replay[i]
      this.step(toInput(frame), spawn, allowDrive, frame.seq)

      // The newest frame's forces are deliberately left standing: the caller's
      // own `world.step()`, later in this same tick, is the step that frame was
      // always going to be integrated by. Stepping it here as well would run
      // the prediction one tick ahead of the input that justifies it, every
      // time a snapshot lands.
      if (i < replay.length - 1)
        this.rig.world.step()
    }

    const ms    = performance.now() - startedAt
    const stats = this.replayStatsData
    stats.bursts++
    stats.lastFrames = replay.length
    stats.lastMs     = ms
    stats.maxFrames  = Math.max(stats.maxFrames, replay.length)
    stats.maxMs      = Math.max(stats.maxMs, ms)
    stats.totalMs   += ms
  }

  private applyServerPose (server: ServerPose): void {
    const body = this.rig.chassis
    body.setTranslation({ x: server.x, y: server.y, z: server.z }, true)
    body.setRotation({ x: server.qx, y: server.qy, z: server.qz, w: server.qw }, true)

    // Velocity comes off the wire with the pose. `ShipState` has carried
    // `vx…wz` since the bit-packed codec replaced the JSON snapshot, and this
    // is the reason it does: a rewind that zeroes velocity instead puts the
    // ship at a standstill at a pose that is a round trip old, and no amount
    // of replaying gets it back up to speed within the frames available. The
    // ship then only ever moves when it is corrected — half a metre at a time,
    // thirty times a second.
    body.setLinvel({ x: server.vx, y: server.vy, z: server.vz }, true)
    body.setAngvel({ x: server.wx, y: server.wy, z: server.wz }, true)

    // The body no longer holds the solved pose of any input frame, so the next
    // `step` must not file it under the one it was about to. The replay
    // re-records every frame it re-simulates on its way back to the present.
    this.steppedSeq = 0
  }

  /**
   * Decay the visual offset and write it into `out`.
   *
   * Called once per RENDERED frame, not per tick: this is presentation, and a
   * 144 Hz display should walk off a correction in the same wall time a 60 Hz
   * one does. Exponential rather than linear so the correction is fastest when
   * it is largest and tapers rather than stopping abruptly.
   */
  smoothing (dt: number, out: Vector3): Vector3 {
    this.smoother.sample(dt, out)
    return out
  }
}
