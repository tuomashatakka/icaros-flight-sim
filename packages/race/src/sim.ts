/**
 * The authoritative race simulation.
 *
 * Race's rules used to live in a zustand store driven by rapier sensor
 * collisions inside a browser module — which meant exactly one ship, in exactly
 * one tab, with no way to run the thing headless. This is the same rules,
 * shaped like `BattleSim`: it owns a rapier world, N ships and N lap states,
 * steps at a fixed dt, and answers with a snapshot and an event list.
 *
 * Everything that makes a run reproducible is constructor-initialised. The
 * replay harness builds a fresh sim per run for exactly that reason — the reset
 * nobody has to write is the one nobody can forget.
 */

import { Quaternion, Vector3 } from 'three'
import { attachBoxColliders } from 'Φcolliders'
import { createHovercraft, createHovercraftState, stepHovercraft } from 'Φvehicle-step'
import { createPhysics } from 'Φworld'
import { initRapier } from 'Φrapier'
import { vehicleConfig } from 'Φconfig'
import { DEFAULT_TUNING } from 'Φtypes'

import { COUNTDOWN_SECONDS, createProgress, passCheckpoint, standings, tickProgress } from './rules'
import { buildCheckpoints, crossedGate } from './track'
import { raceBotInput } from './bot'
import { NEUTRAL_RACE_INPUT } from './types'

import type RAPIER from '@dimforge/rapier3d-deterministic-compat'
import type { HovercraftState } from 'Φvehicle-step'
import type { Physics } from 'Φworld'
import type { ShipId } from 'Φships'
import type { Transform } from 'Φtypes'
import type { Checkpoint, TrackSpec, Vec3Tuple } from './track'
import type { RaceProgress, RaceRules, RaceStatus } from './rules'
import type { RaceEvent, RaceInput, RaceSnapshot, RacerSnapshot } from './types'


/** Aim trim bounds, shared with battle so one wire format covers both. */
export const AIM_MAX  = Math.PI / 4
export const AIM_RATE = 1.1

export type Racer = {
  id:       string;
  name:     string;
  shipId:   ShipId;
  isBot:    boolean;
  chassis:  RAPIER.RigidBody;
  sim:      HovercraftState;
  controls: RaceInput;

  boostMeter:   number;
  aimAngle:     number;
  speed:        number;
  grounded:     boolean;
  lastResetSeq: number;

  // Where the hull was at the END of the previous tick. The gate test is a
  //  segment against a plane, so it needs both ends of the move.
  previous: Vec3Tuple;

  progress: RaceProgress;
  position: number;
}

const _pos  = new Vector3()
const _quat = new Quaternion()

export class RaceSim {
  readonly track:       TrackSpec
  readonly checkpoints: Checkpoint[]
  readonly rules:       RaceRules
  readonly racers:      Racer[] = []

  status: RaceStatus = 'lobby'
  countdown = 0

  private readonly physics: Physics
  private events:           RaceEvent[] = []
  private tickNo = 0
  private idSeq = 0
  private botSeq = 0
  private rngSeed = 0x9e3779b9

  private constructor (track: TrackSpec, physics: Physics) {
    this.track       = track
    this.physics     = physics
    this.checkpoints = buildCheckpoints(track)
    this.rules       = { checkpointCount: this.checkpoints.length, laps: track.laps, loop: track.loop }

    attachBoxColliders(physics, track.colliders, track.colliderOffset)
  }

  static async create (track: TrackSpec): Promise<RaceSim> {
    const RAPIER = await initRapier()
    return new RaceSim(track, createPhysics(RAPIER))
  }

  get tick (): number {
    return this.tickNo
  }

  /**
   * Where a racer starts, spread along the grid behind gate 0.
   *
   * Derived from the index rather than stored, so a racer who joins, leaves and
   * rejoins does not inherit somebody else's box.
   */
  private gridSlot (index: number): Transform {
    const start = this.checkpoints[0]
    const back  = this.checkpoints[this.checkpoints.length - 1] ?? start

    const row  = Math.floor(index / 2)
    const side = index % 2 === 0 ? -1 : 1

    // Step back along the incoming direction, and out to one side of it.
    const fx = start.forward[0]
    const fz = start.forward[2]
    const rx = -fz
    const rz = fx

    const offsetBack = 8 + row * 10
    const offsetSide = side * (this.track.width * 0.2)

    void back
    return {
      position: [
        start.position[0] - fx * offsetBack + rx * offsetSide,
        start.position[1] + 1,
        start.position[2] - fz * offsetBack + rz * offsetSide,
      ],
      quaternion: start.transform.quaternion,
    }
  }

  addPlayer (name: string, shipId: ShipId): Racer {
    return this.addRacer(`p${++this.idSeq}`, name, shipId, false)
  }

  addBot (shipId: ShipId = 'icaras'): Racer {
    return this.addRacer(`bot${++this.botSeq}`, `Drone ${this.botSeq}`, shipId, true)
  }

  private addRacer (id: string, name: string, shipId: ShipId, isBot: boolean): Racer {
    const spawn       = this.gridSlot(this.racers.length)
    const { chassis } = createHovercraft(this.physics.world, spawn)

    const racer: Racer = {
      id,
      name,
      shipId,
      isBot,
      chassis,
      sim:          createHovercraftState(),
      controls:     { ...NEUTRAL_RACE_INPUT },
      boostMeter:   1,
      aimAngle:     0,
      speed:        0,
      grounded:     false,
      lastResetSeq: 0,
      previous:     [ ...spawn.position ] as Vec3Tuple,
      progress:     createProgress(this.rules, spawn),
      position:     this.racers.length + 1,
    }

    this.racers.push(racer)
    return racer
  }

  getRacer (id: string): Racer | undefined {
    return this.racers.find(r => r.id === id)
  }

  removeRacer (id: string): void {
    const index = this.racers.findIndex(r => r.id === id)
    if (index < 0)
      return

    this.physics.world.removeRigidBody(this.racers[index].chassis)
    this.racers.splice(index, 1)
  }

  setInput (id: string, input: RaceInput): void {
    const racer = this.getRacer(id)
    if (racer)
      racer.controls = input
  }

  start (countdown = COUNTDOWN_SECONDS): void {
    this.status    = 'countdown'
    this.countdown = countdown
    this.events.push({ type: 'countdown', value: Math.ceil(countdown) })
  }

  drainEvents (): RaceEvent[] {
    const out   = this.events
    this.events = []
    return out
  }

  dispose (): void {
    this.physics.free()
  }

  /** One fixed tick. `dt` is always `STEP` — never a wall-clock delta. */
  step (dt: number): void {
    this.tickNo++

    if (this.status === 'countdown') {
      const before = Math.ceil(this.countdown)
      this.countdown -= dt

      if (this.countdown <= 0) {
        this.status    = 'racing'
        this.countdown = 0
        this.events.push({ type: 'raceStart' })
      }
      else if (Math.ceil(this.countdown) !== before)
        this.events.push({ type: 'countdown', value: Math.ceil(this.countdown) })
    }

    const racing = this.status === 'racing'

    // FORCES FIRST. Every control is `addForceAtPoint`, and rapier accumulates
    // them until the solve — applying any of this after `world.step()` would
    // silently do nothing for a tick.
    for (const racer of this.racers) {
      if (racer.isBot)
        racer.controls = raceBotInput(this, racer, dt)

      const controls = racer.controls

      let resetRequested = false
      if (controls.resetSeq !== racer.lastResetSeq) {
        racer.lastResetSeq = controls.resetSeq
        resetRequested = true
      }

      // A trim wheel, not a spring: it keeps climbing while the axis is held.
      if (resetRequested)
        racer.aimAngle = 0
      else if (controls.aimPitch)
        racer.aimAngle = Math.max(-AIM_MAX, Math.min(AIM_MAX, racer.aimAngle + controls.aimPitch * AIM_RATE * dt))

      const t           = racer.chassis.translation()
      racer.previous[0] = t.x
      racer.previous[1] = t.y
      racer.previous[2] = t.z

      const out = stepHovercraft({
        chassis:     racer.chassis,
        world:       this.physics.world,
        input:       controls,
        tuning:      DEFAULT_TUNING,
        state:       racer.sim,
        dt,
        allowDrive:  racing,
        spawn:       racer.progress.respawn,
        resetRequested,
        boostMeter:  racer.boostMeter,
        targetSpeed: vehicleConfig.maxSpeed,
      })

      racer.boostMeter = out.boostMeter
      racer.speed      = out.speed
      racer.grounded   = out.grounded

      if (out.respawned) {
        racer.progress.respawnIndex = racer.progress.respawnIndex + 1 & 0xff
        this.events.push({ type: 'respawn', id: racer.id })
      }
    }

    this.physics.world.step()

    if (!racing)
      return

    // Gates AFTER the solve, so the segment tested is the one the ship actually
    // travelled this tick rather than where it was about to be pushed.
    for (const racer of this.racers) {
      tickProgress(racer.progress, dt)
      this.testGates(racer)
    }

    this.rankRacers()
    this.checkEnd()
  }

  private testGates (racer: Racer): void {
    if (racer.progress.finished)
      return

    const t              = racer.chassis.translation()
    const now: Vec3Tuple = [ t.x, t.y, t.z ]
    const gate           = this.checkpoints[racer.progress.nextCheckpoint]
    if (!gate)
      return

    if (!crossedGate(gate, racer.previous, now))
      return

    const result = passCheckpoint(racer.progress, gate.index, gate.transform, this.rules)
    if (!result.counted)
      return

    this.events.push({ type: 'gate', id: racer.id, index: gate.index })

    if (!result.lapCompleted)
      return

    this.events.push({
      type:    'lap',
      id:      racer.id,
      lap:     racer.progress.lap,
      lapTime: result.lapTime,
      best:    racer.progress.bestLap === result.lapTime,
    })

    if (result.finished)
      this.events.push({
        type:      'finish',
        id:        racer.id,
        position:  racer.position,
        totalTime: racer.progress.finishTime ?? racer.progress.elapsed,
      })
  }

  private rankRacers (): void {
    const ordered = standings(this.racers)
    for (let i = 0; i < ordered.length; i++)
      ordered[i].position = i + 1
  }

  private checkEnd (): void {
    if (this.status !== 'racing' || this.racers.length === 0)
      return

    if (this.racers.every(r => r.progress.finished)) {
      this.status = 'finished'
      this.events.push({ type: 'raceEnd' })
    }
  }

  snapshot (): RaceSnapshot {
    return {
      tick:      this.tickNo,
      status:    this.status,
      countdown: this.countdown,
      trackId:   this.track.id,
      laps:      this.track.laps,
      racers:    this.racers.map(racer => this.racerSnapshot(racer)),
    }
  }

  private racerSnapshot (racer: Racer): RacerSnapshot {
    const t = racer.chassis.translation()
    const r = racer.chassis.rotation()

    return {
      id:             racer.id,
      name:           racer.name,
      shipId:         racer.shipId,
      isBot:          racer.isBot,
      x:              t.x,
      y:              t.y,
      z:              t.z,
      qx:             r.x,
      qy:             r.y,
      qz:             r.z,
      qw:             r.w,
      boost:          racer.boostMeter,
      speed:          racer.speed,
      grounded:       racer.grounded,
      lap:            racer.progress.lap,
      nextCheckpoint: racer.progress.nextCheckpoint,
      position:       racer.position,
      elapsed:        racer.progress.elapsed,
      lapElapsed:     racer.progress.lapElapsed,
      bestLap:        racer.progress.bestLap,
      finished:       racer.progress.finished,
      respawnIndex:   racer.progress.respawnIndex,
    }
  }

  // Seeded, and the only randomness in the tick. `Math.random` here would make
  //  every replay hash differ and the determinism harness useless.
  random (): number {
    this.rngSeed = this.rngSeed + 0x6d2b79f5 | 0

    let t        = Math.imul(this.rngSeed ^ this.rngSeed >>> 15, 1 | this.rngSeed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }

  /** The next gate a racer is aiming at, for bots and the HUD arrow. */
  targetGate (racer: Racer): Checkpoint | undefined {
    return this.checkpoints[racer.progress.nextCheckpoint]
  }

  aimAt (racer: Racer, out = _pos): Vector3 {
    const gate = this.targetGate(racer)
    return gate ? out.set(gate.position[0], gate.position[1], gate.position[2]) : out.set(0, 0, 0)
  }

  headingOf (racer: Racer, out = _pos): Vector3 {
    const r = racer.chassis.rotation()
    _quat.set(r.x, r.y, r.z, r.w)
    return out.set(0, 0, 1).applyQuaternion(_quat)
  }
}
