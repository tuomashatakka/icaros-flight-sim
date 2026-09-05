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
 * Correction is deliberately three-tiered rather than a rewind-and-replay on
 * every snapshot, and the reason is specific: rapier's
 * `DynamicRayCastVehicleController` keeps internal per-wheel suspension and
 * friction state that it does not expose for snapshotting. A replay after a
 * hard reset therefore restarts from a state that is close to, but not, the
 * server's — so correcting 30 times a second would fight the controller
 * continuously and produce exactly the shimmer prediction exists to avoid.
 *
 *   · under `DEADBAND`  — leave the body alone. The prediction is tracking.
 *   · under `HARD_SNAP` — reset to the server pose, replay unacknowledged
 *                         input, and absorb the visible jump into a decaying
 *                         render offset.
 *   · over  `HARD_SNAP` — a respawn, a teleport, or a genuine desync. Snap
 *                         everything, smooth nothing; pretending continuity
 *                         across a relocation is what draws a ship streaking
 *                         over the arena.
 */

import { Vector3 } from 'three'
import { STEP } from '@crash-velocity/physics/clock'
import { stepHovercraft } from '@crash-velocity/physics/vehicle-step'
import { MAIN_THRUST_CAPACITY } from '@crash-velocity/physics/thrusters'
import type { VehicleDebug } from '../vehicle'


const COLLECT_FORCES = process.env.NODE_ENV !== 'production'
import { vehicleConfig } from 'Δlib/utils'
import { DEFAULT_TUNING } from '../state'
import type { Transform } from '@crash-velocity/physics/types'
import type { HovercraftState } from '@crash-velocity/physics/vehicle-step'

import type { InputFrame } from '@crash-velocity/net'
import type RAPIER from '@dimforge/rapier3d-deterministic-compat'


/**
 * Position error tolerated before the body is touched at all, metres.
 *
 * Below this the prediction is tracking and a correction would cost more (in
 * disturbed wheel state) than it buys.
 */
const DEADBAND = 0.35

/** Above this, continuity is a fiction — snap rather than smooth. */
const HARD_SNAP = 3

// Render offset decay. ~0.12 s to fall to a tenth, so a correction is felt as
//  a settle rather than seen as a jump.
const SMOOTH_HALF_LIFE = 0.055

/** Per-tick blend for the g meter. ~0.35 s to settle at 60 Hz. */
const G_SMOOTHING = 0.05

/** Trim divergence tolerated before the reticle is pulled to the server's. */
const AIM_EPSILON = 0.02

/**
 * Aim trim bounds. Duplicated from the sims rather than imported from one of
 * them, because importing battle's would make race's prediction depend on
 * battle — and the two agree by construction: one wire format, one ±1 range.
 */
export const AIM_MAX  = Math.PI / 4
export const AIM_RATE = 1.1

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

/** What it needs back from the server. Both modes' merged views satisfy it. */
export type ServerPose = {
  x:            number;
  y:            number;
  z:            number;
  qx:           number;
  qy:           number;
  qz:           number;
  qw:           number;
  aimAngle:     number;
  boost:        number;
  respawnIndex: number;
}

export type PredictionRig = {
  chassis: RAPIER.RigidBody;
  world:   RAPIER.World;
  state:   HovercraftState;
}

export type PredictionResult = {

  /** Metres the body was moved by the last correction; 0 when inside the deadband. */
  correctionM: number;

  // True when continuity was abandoned — the caller must also snap the camera
  //  and any interpolator that was blending this body.
  snapped: boolean;
}

const _serverPos = new Vector3()
const _bodyPos   = new Vector3()

export class LocalPrediction {
  readonly rig: PredictionRig

  // Difference between where the ship was drawn and where it now is, decayed
  //  to zero over a few frames so a correction never reads as a jump.
  private readonly offset = new Vector3()

  private boostMeter = 1
  private groundedNow = false
  private airbrakeNow = 0
  private debugNow:    VehicleDebug | null = null
  private thrustNow = 0
  private gLoadNow = 0
  private aimAngle = 0
  private lastResetSeq = 0
  private respawnSeen: number | null = null

  constructor (rig: PredictionRig) {
    this.rig = rig
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
   */
  step (input: PredictInput, spawn: Transform, allowDrive: boolean): void {
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
   * @param replay frames the server has not acknowledged, oldest first
   */
  reconcile (
    server: ServerPose,
    replay: readonly InputFrame[],
    toInput: (frame: InputFrame) => PredictInput,
    spawn: Transform,
    allowDrive: boolean,
  ): PredictionResult {
    const body = this.rig.chassis
    const t    = body.translation()

    _serverPos.set(server.x, server.y, server.z)
    _bodyPos.set(t.x, t.y, t.z)

    const error      = _serverPos.distanceTo(_bodyPos)
    const respawn    = this.respawnSeen !== null && this.respawnSeen !== server.respawnIndex
    this.respawnSeen = server.respawnIndex

    if (Math.abs(this.aimAngle - server.aimAngle) > AIM_EPSILON)
      this.aimAngle = server.aimAngle

    this.boostMeter = server.boost

    if (!respawn && error <= DEADBAND)
      return { correctionM: 0, snapped: false }

    // Remember where the ship was being drawn, so the correction can be hidden
    // in the render offset rather than seen as a jump.
    const hard = respawn || error > HARD_SNAP
    if (!hard)
      this.offset.add(_bodyPos).sub(_serverPos)

    this.applyServerPose(server)

    // Replay only makes sense for a correction we are smoothing over. After a
    // respawn the input the player was holding was for a ship that no longer
    // exists where it was.
    // Replayed through the SAME converter the server applies frames with — the
    // mode passes it in — so a re-simulated tick is bit-identical to the one
    // being corrected against.
    if (!hard)
      for (const frame of replay)
        this.step(toInput(frame), spawn, allowDrive)

    if (hard) {
      this.offset.set(0, 0, 0)
      this.rig.state.smoothedYawRate = 0
      this.rig.state.prevSpeed       = 0
    }

    return { correctionM: error, snapped: hard }
  }

  private applyServerPose (server: ServerPose): void {
    const body = this.rig.chassis
    body.setTranslation({ x: server.x, y: server.y, z: server.z }, true)
    body.setRotation({ x: server.qx, y: server.qy, z: server.qz, w: server.qw }, true)

    // The snapshot carries no velocity for the local ship — the replay below
    // rebuilds it from the input stream, which is more faithful than a
    // quantised sample would be. Zeroing first stops the pre-correction
    // velocity from being integrated on top of a pose it does not belong to.
    body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  }

  /**
   * Decay the visual offset and write it into `out`.
   *
   * Exponential rather than linear so the correction is fastest when it is
   * largest and tapers rather than stopping abruptly.
   */
  smoothing (dt: number, out: Vector3): Vector3 {
    if (this.offset.lengthSq() > 1e-8)
      this.offset.multiplyScalar(Math.pow(0.5, dt / SMOOTH_HALF_LIFE))
    else
      this.offset.set(0, 0, 0)

    return out.copy(this.offset)
  }
}
