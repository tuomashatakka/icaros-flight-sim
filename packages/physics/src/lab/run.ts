import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import { Euler, Quaternion, Vector3 } from 'three'
import { vehicleConfig } from '../config'
import { THRUSTER_RIG } from '../thrusters'
import { DEFAULT_TUNING } from '../types'
import { createHovercraft, createHovercraftState, stepHovercraft } from '../vehicle-step'
import type { HovercraftInput } from '../vehicle-step'
import { LANE_PITCH } from './cases'
import type { CrashCase, LabFrame, LabSolid, LabTrace } from './cases'

/**
 * Headless crash-dummy runner.
 *
 * Builds a rapier world containing one case's geometry, runs its input
 * timeline, and records EVERY tick — not a sample. "All the debug info for the
 * whole duration" is the requirement, and a sampled trace is exactly the thing
 * that loses the two frames where the interesting thing happened.
 *
 * No DOM, no three.js scene graph, no wall clock. Same determinism rules as
 * `dev:replay`: fixed iteration order, no `Math.random`, wind is a pure function
 * of tick and position. Two runs of one case must hash identically.
 */

const STEP = 1 / 60

/** Zero input, spread over each keyframe so a released key really releases. */
const NEUTRAL: HovercraftInput = {
  steer:    0,
  throttle: false,
  brake:    false,
  boost:    false,
  reverse:  false,
  strafe:   0,
}

export type LabRunOptions = {

  /** Skip the per-thruster and force detail. Only for bulk determinism sweeps. */
  lean?: boolean;
}

function addSolid (world: RAPIER.World, body: RAPIER.RigidBody, solid: LabSolid, offsetX: number) {
  const q = new Quaternion().setFromEuler(
    new Euler(solid.rotation[0], solid.rotation[1], solid.rotation[2])
  )
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(solid.half[0], solid.half[1], solid.half[2])
      .setTranslation(solid.position[0] + offsetX, solid.position[1], solid.position[2])
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    body
  )
}

/**
 * FNV-1a over the pose stream.
 *
 * Fixed six decimals rather than raw bits, because `-0` and `0` are different
 * bit patterns and identical physics, and a hash that trips on that reports
 * non-determinism where there is none.
 */
function hashFrames (frames: readonly LabFrame[]): string {
  let h = 0x811c9dc5
  const eat = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
  }
  for (const f of frames) {
    eat(f.pos.map(n => n.toFixed(6)).join(','))
    eat(f.linvel.map(n => n.toFixed(6)).join(','))
    eat(f.angvel.map(n => n.toFixed(6)).join(','))
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** Resolve the timeline to the input in force at a given tick. */
function inputAt (crash: CrashCase, tick: number): HovercraftInput {
  let live: HovercraftInput = { ...NEUTRAL }
  for (const key of crash.timeline)
    if (tick >= Math.round(key.at * 60))
      live = { ...NEUTRAL, ...key.input }
  return live
}

export async function runCrashCase (crash: CrashCase, options: LabRunOptions = {}): Promise<LabTrace> {
  await RAPIER.init()

  const world    = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = STEP

  const offsetX = crash.lane * LANE_PITCH

  const statics = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  for (const solid of crash.solids)
    addSolid(world, statics, solid, offsetX)

  const propBodies: RAPIER.RigidBody[] = []
  for (const prop of crash.props ?? []) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(prop.position[0] + offsetX, prop.position[1], prop.position[2])
        .setCanSleep(false)
    )
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(prop.half[0], prop.half[1], prop.half[2]).setMass(prop.mass),
      body
    )
    propBodies.push(body)
  }

  const spawn = {
    position:   [ crash.spawn.position[0] + offsetX, crash.spawn.position[1], crash.spawn.position[2] ] as [number, number, number],
    quaternion: crash.spawn.quaternion,
  }
  const { chassis } = createHovercraft(world, spawn)
  const state       = createHovercraftState()

  const frames: LabFrame[]                                     = []
  const props: Array<Array<readonly [number, number, number]>> = []

  const q     = new Quaternion()
  const fwd   = new Vector3()
  const up    = new Vector3()
  const right = new Vector3()

  const totalTicks = Math.round(crash.duration * 60)

  // Settle before the timeline, exactly as `runScenario` does. A case that
  // starts mid-drop is measuring the drop, not the thing it is named after.
  for (let i = 0; i < 60; i++) {
    stepHovercraft({
      chassis,
      world,
      input:          NEUTRAL,
      tuning:         DEFAULT_TUNING,
      state,
      dt:             STEP,
      allowDrive:     false,
      spawn,
      resetRequested: false,
      boostMeter:     1,
      targetSpeed:    vehicleConfig.maxSpeed,
    })
    world.step()
  }

  let boostMeter = 1

  for (let tick = 0; tick < totalTicks; tick++) {
    const pos  = chassis.translation()
    const wind = crash.wind?.(tick, [ pos.x - offsetX, pos.y, pos.z ])

    const out = stepHovercraft({
      chassis,
      world,
      input:          inputAt(crash, tick),
      tuning:         DEFAULT_TUNING,
      state,
      dt:             STEP,
      allowDrive:     true,
      spawn,
      resetRequested: false,
      boostMeter,
      targetSpeed:    crash.targetSpeed ?? vehicleConfig.maxSpeed,
      collectForces:  !options.lean,
      externalForce:  wind,
    })
    boostMeter = out.boostMeter

    world.step()

    const t = chassis.translation()
    const r = chassis.rotation()
    const v = chassis.linvel()
    const w = chassis.angvel()
    q.set(r.x, r.y, r.z, r.w)
    fwd.set(0, 0, 1).applyQuaternion(q)
    up.set(0, 1, 0).applyQuaternion(q)
    right.set(1, 0, 0).applyQuaternion(q)

    frames.push({
      tick,
      // Lane-local, so a check reads the same numbers the case was authored in.
      pos:       [ t.x - offsetX, t.y, t.z ],
      linvel:    [ v.x, v.y, v.z ],
      angvel:    [ w.x, w.y, w.z ],
      fwdSpeed:  v.x * fwd.x + v.y * fwd.y + v.z * fwd.z,
      latSpeed:  v.x * right.x + v.y * right.y + v.z * right.z,
      speed:     out.speed,
      yawRate:   w.x * up.x + w.y * up.y + w.z * up.z,
      up:        up.y,
      pitch:     Math.asin(Math.max(-1, Math.min(1, -fwd.y))),
      roll:      Math.asin(Math.max(-1, Math.min(1, -right.y))),
      grounded:  out.grounded,
      contacts:  out.contacts,
      airbrake:  out.airbrake,
      engine:    out.engineForce,
      netForce:  out.netForce,
      netTorque: out.netTorque,
      forces:    options.lean
        ? []
        : out.forces.map(f => ({
          id:     f.id,
          group:  f.group,
          point:  [ f.point[0] - offsetX, f.point[1], f.point[2] ] as [number, number, number],
          vector: [ f.vector[0], f.vector[1], f.vector[2] ] as [number, number, number],
        })),
      throttles: options.lean
        ? []
        : THRUSTER_RIG.map(th => {
          const found = out.forces.find(f => f.id === th.id)
          if (!found)
            return 0
          return Math.hypot(found.vector[0], found.vector[1], found.vector[2]) / th.maxForce
        }),
    })

    props.push(propBodies.map(body => {
      const p = body.translation()
      return [ p.x - offsetX, p.y, p.z ] as const
    }))
  }

  return { id: crash.id, frames, props, hash: hashFrames(frames) }
}

/** Run every case. Sequential on purpose — rapier's wasm is one instance. */
export async function runAllCrashCases (
  cases: readonly CrashCase[],
  options?: LabRunOptions
): Promise<LabTrace[]> {
  const out: LabTrace[] = []
  for (const crash of cases)
    out.push(await runCrashCase(crash, options))
  return out
}
