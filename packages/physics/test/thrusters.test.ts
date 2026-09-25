import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { AIRBRAKE_PANELS, DOWNFORCE, DRAG, INERTIA, THRUSTER_RIG } from 'Φthrusters'
import { vehicleConfig } from 'Φconfig'

/**
 * The rig's GEOMETRY is the handling model.
 *
 * Every coupling the ship has — banking into a strafe, a pad over a rise
 * pitching the hull — is `tau = r x F` for a nozzle bolted somewhere specific.
 * There is no code downstream that adds those effects, so moving a mount point
 * by a few centimetres silently changes how the ship drives and nothing else
 * would notice. These pin the signs.
 *
 * Body axes: +Y up, +Z forward, so +X is PORT (the pilot's left). A POSITIVE
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
  it('puts the main and yaw nozzles behind the centre of mass', () => {
    // A yaw jet or a main that crept forward of the COM would flip the sign of
    // its torque rather than merely weakening it.
    for (const t of THRUSTER_RIG)
      if (t.group === 'main' || t.group === 'rcs')
        expect(t.pos[2], `${t.id} should be aft of the COM`).toBeLessThan(0)
  })

  it('names each lateral nozzle for the way it pushes the pilot', () => {
    // +X is port. `lateral.R` must push to starboard, or `strafe > 0` — the same
    // sense as `steer > 0` — slides the ship to the left.
    expect(byId('lateral.R').dir[0]).toBeLessThan(0)
    expect(byId('lateral.L').dir[0]).toBeGreaterThan(0)
  })

  it('strafes sideways without yawing or pitching', () => {
    // The nozzles used to sit a metre aft, and a strafe was then mostly a yaw
    // AWAY from the key — the tail pushed right swings the nose left.
    const tau = torqueOf('lateral.R')

    expect(tau.y, 'no yaw').toBeCloseTo(0, 6)
    expect(tau.x, 'no pitch').toBeCloseTo(0, 6)
  })

  it('banks into a strafe to starboard, port side up', () => {
    // Positive about +Z (forward) lifts +X, the port side.
    expect(torqueOf('lateral.R').z).toBeGreaterThan(0)
  })

  it('mirrors that bank exactly for a leftward strafe', () => {
    const right = torqueOf('lateral.R')
    const left  = torqueOf('lateral.L')

    expect(left.z).toBeCloseTo(-right.z, 6)
    expect(left.y).toBeCloseTo(0, 6)
  })

  it('produces no net torque from balanced main thrust', () => {
    const sum = torqueOf('main.L').add(torqueOf('main.R'))
    expect(sum.length()).toBeCloseTo(0, 6)
  })

  it('steers right with rcs.R and left with rcs.L', () => {
    expect(torqueOf('rcs.R').y).toBeLessThan(0)
    expect(torqueOf('rcs.L').y).toBeGreaterThan(0)
  })

  it('gives the yaw jets authority over anything a strafe could induce', () => {
    // If a strafe can out-torque the steering the ship just spins — which it
    // did, while the lateral pair sat at the tail.
    expect(Math.abs(torqueOf('rcs.R').y)).toBeGreaterThan(Math.abs(torqueOf('lateral.R').y) * 4)
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
