/**
 * The local ship has to be DRAWN moving continuously.
 *
 * Every mode is server-authoritative and every mode predicts the local ship, so
 * "the ship jumps a couple of times a second, in all modes" was never a physics
 * bug — it was reconciliation correcting a prediction that could not converge,
 * on every single snapshot, thirty times a second.
 *
 * Three separate things had to be true for it to converge, and each of them
 * failed silently on its own:
 *
 *  1. the error is measured at the tick the server ANSWERED for, not at the one
 *     the client is drawing — otherwise the round trip reads as error;
 *  2. the rewind restores velocity as well as pose — the wire carries it;
 *  3. the replay INTEGRATES each frame, because `LocalPrediction.step` only
 *     applies forces and `world.step()` lives in `physicsStepModule`.
 *
 * So this test does not check any of the three directly. It runs a real race
 * room against the real client prediction over a real latency and asserts the
 * only thing a player can actually see: the drawn ship never moves further in
 * one frame than it could fly, and the predicted ship keeps up with the server
 * under its own power rather than being dragged along by its corrections.
 */

import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'

import { STEP } from 'Φclock'
import { vehicleConfig } from 'Φconfig'
import { initRapier } from 'Φrapier'
import { createPhysics } from 'Φworld'
import { attachBoxColliders } from 'Φcolliders'
import { createHovercraft, createHovercraftState } from 'Φvehicle-step'
import { BodyInterpolator } from 'Φinterpolation'
import { PendingInputs, PredictedPoses, acceptPacket, createSeat, drainInput } from 'Ξ'
import { RaceSim } from 'Λsim'
import { trackBundle } from 'Λlevels'
import { fromRaceInput, toRaceInput } from 'Λinput'
import { NEUTRAL_RACE_INPUT } from 'Λtypes'

import { LocalPrediction } from 'Σnet/prediction'

import type { InputFrame } from 'Ξ'
import type { Transform } from 'Φtypes'
import type { ServerPose } from 'Σnet/prediction'


/** One-way latency, so the round trip is the 100 ms the netcode is sized for. */
const ONE_WAY_MS = 50

const RENDER_HZ = 60
const SECONDS   = 8

/** Ticks ignored while the ship gets off the line and the link fills up. */
const WARMUP_TICKS = 120

/**
 * The furthest the ship can physically travel between two rendered frames.
 *
 * Top speed on full boost, which this run never reaches. A drawn step past it
 * is not motion — it is a correction the render offset failed to absorb.
 */
const MAX_FRAME_M = vehicleConfig.maxSpeed * vehicleConfig.boostSpeedMultiplier / RENDER_HZ

const median = (values: readonly number[]): number =>
  [ ...values ].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0

type Downlink = { at: number; tick: number; ack: number; pose: ServerPose }
type Uplink = { at: number; frames: InputFrame[] }

type Run = {
  frameSteps:  number[];
  corrections: Array<{ tick: number; tier: string; metres: number }>;
  clientSpeed: number;
  serverSpeed: number;
}

type NudgeType = { atTick: number; metres: number }

type Velocity = { linvel(): { x: number; y: number; z: number }}

const speedOf = (body: Velocity): number => {
  const v = body.linvel()
  return Math.hypot(v.x, v.y, v.z)
}

/** One ship on the wire, the way both sims fill a `ShipState`. */
type BodyType = {
  translation(): { x: number; y: number; z: number };
  rotation(): { x: number; y: number; z: number; w: number };
  linvel(): { x: number; y: number; z: number };
  angvel(): { x: number; y: number; z: number };
}

const poseOf = (body: BodyType, aimAngle: number, boost: number, respawnIndex: number): ServerPose => {
  const t = body.translation()
  const r = body.rotation()
  const v = body.linvel()
  const w = body.angvel()
  return {
    x:  t.x,
    y:  t.y,
    z:  t.z,
    qx: r.x,
    qy: r.y,
    qz: r.z,
    qw: r.w,
    vx: v.x,
    vy: v.y,
    vz: v.z,
    wx: w.x,
    wy: w.y,
    wz: w.z,
    aimAngle,
    boost,
    respawnIndex,
  }
}

/**
 * A room, a client, and a wire between them.
 *
 * The client world is built the way `scenes/base.ts` builds it — the track's
 * own colliders and exactly one dynamic body — because that is what makes it
 * safe for a replay to step it.
 */
async function flyBothEnds (steer: number, nudge?: NudgeType): Promise<Run> {
  const { spec } = trackBundle('flats')
  const server   = await RaceSim.create(spec)
  const racer    = server.addPlayer('Pilot', 'icaras')
  server.start(0)

  const spawn  = racer.progress.respawn
  const RAPIER = await initRapier()
  const client = createPhysics(RAPIER)
  attachBoxColliders(client, spec.colliders, spec.colliderOffset)

  const { chassis }  = createHovercraft(client.world, spawn)
  const interpolator = new BodyInterpolator(chassis)
  const prediction   = new LocalPrediction({ chassis, world: client.world, state: createHovercraftState(), interpolator })
  const pending      = new PendingInputs()
  const seat         = createSeat(racer.id, 1)

  const downlink: Downlink[] = []
  const uplink: Uplink[]     = []

  const drawn    = new Vector3()
  const quat     = new Quaternion()
  const offset   = new Vector3()
  const previous = new Vector3()

  const frameSteps: number[]            = []
  const corrections: Run['corrections'] = []

  let newestSnapshot = 0

  for (let tick = 0; tick < Math.round(SECONDS * 60); tick++) {
    const nowMs = tick * STEP * 1000

    // Queue, predict, send — the order the composition roots use.
    const frame = pending.push(fromRaceInput({ ...NEUTRAL_RACE_INPUT, throttle: true, steer }, tick))
    prediction.step(toRaceInput(frame), spawn, true, frame.seq)
    uplink.push({ at: nowMs + ONE_WAY_MS, frames: [ ...pending.all ]})

    while (downlink.length > 0 && downlink[0].at <= nowMs) {
      const wire = downlink.shift()!
      if (wire.tick <= newestSnapshot)
        continue

      newestSnapshot = wire.tick
      pending.acknowledge(wire.ack)

      const result = prediction.reconcile({
        server:     wire.pose,
        ack:        wire.ack,
        replay:     pending.all,
        toInput:    toRaceInput,
        spawn,
        allowDrive: true,
      })

      if (result.tier !== 'none')
        corrections.push({ tick, tier: result.tier, metres: result.correctionM })
    }

    client.world.step()
    interpolator.commit()

    // The render, exactly as `scenes/base.ts` does it: the interpolated body
    // pose plus whatever is left of the last correction.
    interpolator.sample(0, drawn, quat)
    drawn.add(prediction.smoothing(1 / RENDER_HZ, offset))
    if (tick > WARMUP_TICKS)
      frameSteps.push(drawn.distanceTo(previous))
    previous.copy(drawn)

    // The server's own input queue, drain rule and snapshot cadence.
    while (uplink.length > 0 && uplink[0].at <= nowMs)
      acceptPacket(seat, { frames: uplink.shift()!.frames, lastAckSnapshot: newestSnapshot, interpTick: 0 })

    for (const applied of drainInput(seat))
      server.setInput(racer.id, toRaceInput(applied))

    server.step(STEP)

    // A deliberate divergence, mid-flight, big enough to be worth correcting
    // and small enough to be worth hiding: a lost input packet, a contact the
    // client resolved differently, a bot that shoved the server's copy. The
    // prediction cannot see it coming, which is the point.
    if (nudge && tick === nudge.atTick) {
      const at = racer.chassis.translation()
      racer.chassis.setTranslation({ x: at.x + nudge.metres, y: at.y, z: at.z }, true)
    }

    if (tick % 2 === 0)
      downlink.push({
        at:   nowMs + ONE_WAY_MS,
        tick: server.tick,
        ack:  seat.lastProcessedInput,
        pose: poseOf(racer.chassis, racer.aimAngle, racer.boostMeter, racer.progress.respawnIndex),
      })
  }

  const run: Run = {
    frameSteps,
    corrections: corrections.filter(entry => entry.tick > WARMUP_TICKS),
    clientSpeed: speedOf(chassis),
    serverSpeed: speedOf(racer.chassis),
  }

  server.dispose()
  client.free()
  return run
}

describe('local prediction', () => {
  it('draws the ship moving continuously under a 100 ms round trip', async () => {
    const run = await flyBothEnds(0.6)

    expect(run.frameSteps.length).toBeGreaterThan(300)

    // The one thing a player sees. Before the fix this fired several hundred
    // times in eight seconds: every snapshot moved the body and nothing
    // absorbed the jump, so the ship was drawn stepping forward at 30 Hz.
    const cuts = run.frameSteps.filter(step => step > MAX_FRAME_M)
    expect(cuts).toEqual([])
  })

  it('keeps the predicted ship flying under its own power', async () => {
    const run = await flyBothEnds(0.6)

    // The prediction runs the same `stepHovercraft` at the same `STEP` from the
    // same inputs, so at a steady throttle it should be travelling at the
    // server's speed. A rewind that zeroed velocity left this at walking pace
    // against a server doing fifty, with the corrections themselves dragging
    // the ship along.
    expect(run.serverSpeed).toBeGreaterThan(20)
    expect(run.clientSpeed).toBeGreaterThan(run.serverSpeed * 0.9)
  })

  it('does not correct a prediction that is tracking', async () => {
    const run = await flyBothEnds(0.6)

    // Snapshots arrive 30 times a second for eight seconds. Measuring the error
    // at the acknowledged tick rather than the drawn one is what keeps this
    // near zero; measuring it at the drawn one reads the whole round trip as
    // error and corrects on every last one of them.
    expect(run.corrections.length).toBeLessThan(SECONDS)
  })
})

describe('a correction the prediction could not avoid', () => {
  it('is walked off by the render rather than drawn as a jump', async () => {
    // Between the deadband and the snap threshold, so it must be BLENDED —
    // moved on the body at once and hidden in the render offset.
    const run = await flyBothEnds(0.6, { atTick: 300, metres: 2.8 })

    const blends = run.corrections.filter(entry => entry.tier === 'blend')
    expect(blends.length).toBeGreaterThan(0)
    expect(blends.every(entry => entry.metres > 0.35 && entry.metres <= 3)).toBe(true)

    // And the player never sees it happen. These two are what keep
    // `renderOffset` wired into the render path: the smoother can be perfect
    // and still be dead code if nothing adds it to the drawn pose.
    expect(run.frameSteps.filter(step => step > MAX_FRAME_M)).toEqual([])

    // Held throttle and constant steer, so every frame of this run draws the
    // same step but the ones the correction is being walked off across. The
    // offset spreads it over ~8 frames of easing; drawn straight onto the body
    // it resolves in two — one long step and one frozen frame, which is the
    // shape of the jump this whole test exists for.
    const cruise   = median(run.frameSteps)
    const settling = run.frameSteps.filter(step => Math.abs(step - cruise) > cruise * 0.02)
    expect(settling.length).toBeGreaterThanOrEqual(4)
  })
})

describe('replay burst instrumentation', () => {
  it('reports the frame count and increments bursts when a correction replays', async () => {
    // A bare client half — no server, no room — because the thing under test
    // is `replayInput`'s own bookkeeping, not reconciliation's convergence.
    const { spec } = trackBundle('flats')
    const RAPIER   = await initRapier()
    const client   = createPhysics(RAPIER)
    attachBoxColliders(client, spec.colliders, spec.colliderOffset)

    const spawn: Transform = { position: [ 0, 2, 0 ], quaternion: [ 0, 0, 0, 1 ] }
    const { chassis }   = createHovercraft(client.world, spawn)
    const interpolator  = new BodyInterpolator(chassis)
    const prediction    = new LocalPrediction({ chassis, world: client.world, state: createHovercraftState(), interpolator })

    const pending       = new PendingInputs()
    const REPLAY_FRAMES = 5
    const replay: InputFrame[] = []
    for (let i = 0; i < REPLAY_FRAMES; i++)
      replay.push(pending.push(fromRaceInput({ ...NEUTRAL_RACE_INPUT, throttle: true }, i)))

    const bursts = prediction.replayStats().bursts

    // Far past `hardSnap`, so the tier can never come back `'none'` — this is
    // about the burst a correction replays, not whether this particular error
    // happens to clear the deadband.
    const server: ServerPose = {
      x: 500, y: 2, z: 500,
      qx: 0, qy: 0, qz: 0, qw: 1,
      vx: 0, vy: 0, vz: 0,
      wx: 0, wy: 0, wz: 0,
      aimAngle:     0,
      boost:        1,
      respawnIndex: 0,
    }

    const result = prediction.reconcile({
      server,
      ack: 0,
      replay,
      toInput: toRaceInput,
      spawn,
      allowDrive: true,
    })

    expect(result.tier).not.toBe('none')
    expect(prediction.replayStats().lastFrames).toBe(REPLAY_FRAMES)
    expect(prediction.replayStats().bursts).toBe(bursts + 1)

    client.free()
  })
})

describe('PredictedPoses', () => {
  it('reads back the pose filed under a sequence number', () => {
    const history = new PredictedPoses()
    const out     = new Vector3()

    history.record(7, 1, 2, 3)
    history.record(8, 4, 5, 6)

    expect(history.find(7, out)).toBeTruthy()
    expect([ out.x, out.y, out.z ]).toEqual([ 1, 2, 3 ])
    expect(history.find(8, out)).toBeTruthy()
    expect([ out.x, out.y, out.z ]).toEqual([ 4, 5, 6 ])
  })

  it('answers null rather than guessing', () => {
    const history = new PredictedPoses()
    const out     = new Vector3()

    // Nothing recorded yet — the first snapshots after a join. The caller falls
    // back to the present pose; a wrong pose would be worse than no pose.
    expect(history.find(1, out)).toBeNull()

    history.record(1, 0, 0, 0)
    expect(history.find(2, out)).toBeNull()

    // A relocation invalidates everything before it.
    history.reset()
    expect(history.find(1, out)).toBeNull()
  })

  it('keeps the newest pose when a sequence is recorded twice', () => {
    const history = new PredictedPoses()
    const out     = new Vector3()

    // The replay re-simulates frames the history already holds. The corrected
    // pose is the true one, and `find` walks back from the newest slot.
    history.record(4, 1, 1, 1)
    history.record(4, 9, 9, 9)

    history.find(4, out)
    expect([ out.x, out.y, out.z ]).toEqual([ 9, 9, 9 ])
  })
})
