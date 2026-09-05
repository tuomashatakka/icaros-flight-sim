/**
 * Headless check of the REAL vehicle physics.
 *
 * This used to be a hand-copied transcription of the step function with its own
 * `cfg` object, which had drifted several tuning generations out of date — it
 * still had `maxYawRate: 2.4` long after the live value became 1.45, so it was
 * validating a ship nobody drove. It now imports `stepHovercraft` itself, and
 * the only thing it owns is the world it runs in.
 *
 * Run: `bun run test:physics`
 */
import RAPIER from '@dimforge/rapier3d-deterministic-compat'
import { Quaternion, Vector3 } from 'three'
import { vehicleConfig } from '@/lib/utils'
import { DEFAULT_TUNING } from '@crash-velocity/physics/types'
import { createHovercraft, createHovercraftState, stepHovercraft } from '@crash-velocity/physics/vehicle-step'
import type { HovercraftInput } from '@crash-velocity/physics/vehicle-step'


await RAPIER.init()

const STEP  = 1 / 60
const SPAWN = { position: [ 0, 1, 0 ] as [number, number, number], quaternion: [ 0, 0, 0, 1 ] as [number, number, number, number]}

const NEUTRAL: HovercraftInput = { steer: 0, throttle: false, brake: false, boost: false, strafe: 0 }

function makeWorld () {
  const world    = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = STEP

  const ground   = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
  world.createCollider(RAPIER.ColliderDesc.cuboid(400, 0.5, 400).setTranslation(0, -0.5, 0), ground)
  return world
}

type Probe = {
  y:        number;
  speed:    number;
  fwdSpeed: number;
  yawRate:  number;
  pitch:    number;
  roll:     number;
  up:       number;
  grounded: boolean;
}

/** Run `ticks` of one input and report the final state. */
function run (input: Partial<HovercraftInput>, ticks: number, settle = 120) {
  const world            = makeWorld()
  const { chassis }      = createHovercraft(world, SPAWN)
  const state            = createHovercraftState()
  const samples: Probe[] = []

  const step = (control: HovercraftInput) => {
    stepHovercraft({
      chassis,
      world,
      input:          control,
      tuning:         DEFAULT_TUNING,
      state,
      dt:             STEP,
      allowDrive:     true,
      spawn:          SPAWN,
      resetRequested: false,
      boostMeter:     1,
      targetSpeed:    vehicleConfig.maxSpeed,
    })
    world.step()
  }

  for (let i = 0; i < settle; i++)
    step(NEUTRAL)

  const control = { ...NEUTRAL, ...input }
  const q       = new Quaternion()
  const fwd     = new Vector3()
  const up      = new Vector3()
  const right   = new Vector3()

  for (let i = 0; i < ticks; i++) {
    step(control)

    const t = chassis.translation()
    const r = chassis.rotation()
    const v = chassis.linvel()
    const w = chassis.angvel()
    q.set(r.x, r.y, r.z, r.w)
    fwd.set(0, 0, 1).applyQuaternion(q)
    up.set(0, 1, 0).applyQuaternion(q)
    right.set(1, 0, 0).applyQuaternion(q)

    samples.push({
      y:        t.y,
      speed:    Math.hypot(v.x, v.y, v.z),
      fwdSpeed: v.x * fwd.x + v.y * fwd.y + v.z * fwd.z,
      yawRate:  w.x * up.x + w.y * up.y + w.z * up.z,
      // Positive pitch = nose down, positive roll = right side down.
      pitch:    Math.asin(Math.max(-1, Math.min(1, -fwd.y))),
      roll:     Math.asin(Math.max(-1, Math.min(1, -right.y))),
      up:       up.y,
      grounded: false,
    })
  }

  return samples
}

const last = <T>(a: T[]): T => a[a.length - 1]
const fmt  = (n: number) => n.toFixed(3).padStart(8)

const checks: Array<[string, boolean]> = []
const check                            = (label: string, ok: boolean) => checks.push([ label, ok ])

// --- 1. Does it float, and does it stop bouncing? -------------------------
const idle  = run({}, 300)
const tail  = idle.slice(-120)
const minY  = Math.min(...tail.map(s => s.y))
const maxY  = Math.max(...tail.map(s => s.y))
const restY = last(idle).y
console.log(`hover      rest y ${fmt(restY)}   band ${fmt(minY)}..${fmt(maxY)}  (settled band should be < 0.05)`)
check('floats above the deck', restY > 0.15)
check('hover settles (no porpoise)', maxY - minY < 0.05)
check('stays upright at rest', last(idle).up > 0.99)

// --- 2. Straight line ------------------------------------------------------
const drive = run({ throttle: true }, 600)
const top   = Math.max(...drive.map(s => s.fwdSpeed))
console.log(`throttle   top fwd speed ${fmt(top)}   (target ${vehicleConfig.maxSpeed})`)
check('reaches most of target speed', top > vehicleConfig.maxSpeed * 0.8)
check('does not exceed target speed much', top < vehicleConfig.maxSpeed * 1.1)
check('upright under thrust', Math.min(...drive.map(s => s.up)) > 0.9)

// --- 3. Steering -----------------------------------------------------------
const turn    = run({ throttle: true, steer: 1 }, 300)
const yawRate = last(turn).yawRate
console.log(`steer=+1   yaw rate ${fmt(yawRate)}   (want negative: +steer is a RIGHT turn)`)
check('steer right yaws right', yawRate < -0.2)
check('upright through a turn', Math.min(...turn.map(s => s.up)) > 0.8)

// --- 4. Strafe coupling — the whole reason the thrusters sit at the tail ----
const strafe = run({ throttle: true, strafe: 1 }, 90)
const sYaw   = last(strafe).yawRate
const sRoll  = last(strafe).roll
const sPitch = last(strafe).pitch
console.log(`strafe=+1  yaw ${fmt(sYaw)}  roll ${fmt(sRoll)}  pitch ${fmt(sPitch)}`)
console.log('           (want: yaw < 0 into the strafe, roll > 0 banking into it, pitch > 0 nose down)')
check('strafe induces yaw toward the strafe', sYaw < -0.02)
check('strafe banks into the strafe', sRoll > 0.005)
check('strafe dips the nose', sPitch > 0.003)

// --- 5. Braking ------------------------------------------------------------
// Holding brake from a standstill is the reverse gear. It has to stay a parking
// speed rather than becoming a second, backwards top speed.
const brake    = run({ brake: true }, 300, 240)
const reverseV = Math.max(...brake.map(s => Math.abs(s.fwdSpeed)))
console.log(`brake      peak reverse ${fmt(reverseV)}   (governed to ~12 m/s)`)
check('reverse stays a parking speed', reverseV < 15)
check('brake does not flip the ship', last(brake).up > 0.9)

// --- 6. Station keeping — throttle AND brake held together -----------------
const hold  = run({ throttle: true, brake: true }, 420)
const drift = Math.max(...hold.map(s => Math.abs(s.fwdSpeed)))
console.log(`hold t+b   peak drift ${fmt(drift)}   final ${fmt(last(hold).fwdSpeed)}  (engines lit, hull parked)`)
check('station keeping holds position', drift < 3 && Math.abs(last(hold).fwdSpeed) < 0.6)
check('station keeping stays upright', last(hold).up > 0.99)

let failed = 0
console.log('')
for (const [ label, ok ] of checks) {
  if (!ok)
    failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed')
process.exit(failed ? 1 : 0)
