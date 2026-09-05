import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { AIRBRAKE_PANELS, DOWNFORCE, DRAG, INERTIA, THRUSTER_RIG } from 'Φthrusters'
import { vehicleConfig } from 'Φconfig'

/**
 * The rig's GEOMETRY is the handling model.
 *
 * Every coupling the ship has — strafing swinging the nose, banking into a
 * slide, the nose dipping — is `tau = r x F` for a nozzle bolted somewhere
 * specific. There is no code downstream that adds those effects, so moving a
 * mount point by a few centimetres silently changes how the ship drives and
 * nothing else would notice. These pin the signs.
 *
 * Body axes: +X right, +Y up, +Z forward. Per the repo convention a POSITIVE
 * torque about +Y is a LEFT turn.
 */

const byId = (id: string) => {
  const thruster = THRUSTER_RIG.find(t => t.id === id)
  if (!thruster)
    throw new Error(`no thruster ${id}`)
  return thruster
}

/** Torque about the centre of mass for one thruster at full throttle. */
const torqueOf = (id: string) => {
  const t = byId(id)
  const r = new Vector3(...t.pos)
  const f = new Vector3(...t.dir).multiplyScalar(t.maxForce)
  return new Vector3().crossVectors(r, f)
}

describe('thruster rig geometry', () => {
  it('puts every propulsion nozzle behind the centre of mass', () => {
    // The brief: thrusters live at the rear, so horizontal thrust cannot help
    // but rotate the ship. A nozzle that crept forward of the COM would flip the
    // sign of the coupling rather than merely weakening it.
    for (const t of THRUSTER_RIG)
      if (t.group === 'main' || t.group === 'lateral' || t.group === 'rcs')
        expect(t.pos[2], `${t.id} should be aft of the COM`).toBeLessThan(0)
  })

  it('couples a rightward strafe into yaw, roll and pitch at once', () => {
    const tau = torqueOf('lateral.R')

    expect(tau.y, 'nose swings toward the strafe (right = negative about +Y)').toBeLessThan(0)
    expect(tau.z, 'banks INTO the strafe, right side down').toBeLessThan(0)
    expect(tau.x, 'front tip nudges DOWN').toBeGreaterThan(0)
  })

  it('mirrors that coupling exactly for a leftward strafe', () => {
    const right = torqueOf('lateral.R')
    const left  = torqueOf('lateral.L')

    expect(left.y).toBeCloseTo(-right.y, 6)
    expect(left.z).toBeCloseTo(-right.z, 6)
    // Pitch does NOT mirror: both nozzles cant upward, so either strafe drops
    // the nose. A sign flip here would mean one direction pitches you up.
    expect(left.x).toBeCloseTo(right.x, 6)
    expect(left.x).toBeGreaterThan(0)
  })

  it('produces no net torque from balanced main thrust', () => {
    const sum = torqueOf('main.L').add(torqueOf('main.R'))
    expect(sum.length()).toBeCloseTo(0, 6)
  })

  it('steers right with rcs.R and left with rcs.L', () => {
    expect(torqueOf('rcs.R').y).toBeLessThan(0)
    expect(torqueOf('rcs.L').y).toBeGreaterThan(0)
  })

  it('gives the yaw jets enough authority to cancel a full strafe', () => {
    // If a strafe can out-torque the steering the ship just spins, and the
    // coupling stops being a trade-off and becomes a loss of control.
    expect(Math.abs(torqueOf('rcs.R').y)).toBeGreaterThan(Math.abs(torqueOf('lateral.R').y))
  })

  it('mounts the hover pads at four corners', () => {
    const pads = THRUSTER_RIG.filter(t => t.group === 'lift')
    expect(pads).toHaveLength(4)

    // Both signs on both axes, or the differential-lift attitude control has no
    // arm to work with on one of them.
    expect(new Set(pads.map(p => Math.sign(p.pos[0])))).toEqual(new Set([ -1, 1 ]))
    expect(new Set(pads.map(p => Math.sign(p.pos[2])))).toEqual(new Set([ -1, 1 ]))
    for (const pad of pads)
      expect(pad.dir).toEqual([ 0, 1, 0 ])
  })

  it('caps total hover thrust below twice the ship weight', () => {
    // The no-bounce invariant. Above 2x weight the pads can push the hull back
    // up harder than gravity pulled it down, and a landing becomes a launch.
    const weight = vehicleConfig.mass * 9.81
    const total  = THRUSTER_RIG.filter(t => t.group === 'lift')
      .reduce((a, t) => a + t.maxForce, 0)

    expect(total).toBeGreaterThan(weight)
    expect(total).toBeLessThanOrEqual(weight * 2)
  })
})

describe('aerodynamics', () => {
  it('resists sideways travel far harder than forward travel', () => {
    // This anisotropy IS the hovercraft's grip; isotropic drag slides out of
    // every corner.
    expect(DRAG.lat).toBeGreaterThan(DRAG.long * 3)
    expect(DRAG.vert).toBeGreaterThan(DRAG.long)
  })

  it('makes real downforce at speed', () => {
    // Hover pads only push up, so without this there is nothing to put the ship
    // back on the track after a crest and it ramps off into the void.
    const atTopSpeed = DOWNFORCE * vehicleConfig.maxSpeed ** 2
    expect(atTopSpeed).toBeGreaterThan(vehicleConfig.mass * 9.81 * 0.3)
    expect(atTopSpeed).toBeLessThan(vehicleConfig.mass * 9.81)
  })

  it('mounts the air brakes outboard so a one-sided deploy yaws', () => {
    expect(AIRBRAKE_PANELS).toHaveLength(2)

    const [ left, right ] = AIRBRAKE_PANELS
    expect(Math.sign(left.pos[0])).toBe(-Math.sign(right.pos[0]))
    expect(Math.abs(left.pos[0])).toBeGreaterThan(vehicleConfig.width / 2)
  })
})

describe('inertia', () => {
  it('is much cheaper to roll than to yaw', () => {
    // A long thin hull. Worth pinning because the attitude gains are sized
    // against these, and it is why the ship banks so much more readily than it
    // turns.
    expect(INERTIA.roll).toBeLessThan(INERTIA.yaw / 3)
    expect(INERTIA.yaw).toBeGreaterThan(INERTIA.pitch)
  })
})
