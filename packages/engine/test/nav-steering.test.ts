import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { angleDelta, bearingOf, steerToward, tapGroundPoint } from 'Σnav/steering'


/** Hull looking down its own +Z, yawed by `heading` radians. */
function hull (heading: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading)
}

describe('tap ground point', () => {
  // A camera 20 up and 20 back of the origin, looking at it.
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 400)
  camera.position.set(0, 20, -20)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()

  it('puts a centre tap on the plane in front of the camera', () => {
    const out = new THREE.Vector3()
    expect(tapGroundPoint(camera, 0, 0, 0, out)).toBe(true)
    expect(out.y).toBeCloseTo(0, 5)
    // Looking from -Z toward the origin, so the ground under the crosshair is
    // ahead of the camera in +Z.
    expect(out.z).toBeGreaterThan(camera.position.z)
  })

  it('lands a tap left of centre to the camera-left of one at centre', () => {
    const centre = new THREE.Vector3()
    const left   = new THREE.Vector3()
    tapGroundPoint(camera, 0, 0, 0, centre)
    tapGroundPoint(camera, -0.5, 0, 0, left)
    expect(left.x).not.toBeCloseTo(centre.x, 1)
    expect(left.y).toBeCloseTo(0, 5)
  })

  it('reports failure only when the ray cannot reach the plane', () => {
    const out    = new THREE.Vector3()
    const facing = new THREE.PerspectiveCamera(60, 1, 0.1, 400)
    facing.position.set(0, 5, 0)
    facing.lookAt(0, 5, 10)
    facing.updateMatrixWorld(true)
    // A horizontal ray 5 above the ground plane never meets it. (Aimed AT its
    //  own height it would, because three.js counts a ray lying IN the plane as
    //  a hit at its origin — which is right, and not this case.)
    expect(tapGroundPoint(facing, 0, 0, 0, out)).toBe(false)
  })
})

describe('steer toward', () => {
  const ARRIVE = 6

  it('reports arrival inside the radius and commands nothing', () => {
    const command = steerToward(
      new THREE.Vector3(0, 1, 0), hull(0), new THREE.Vector3(0, 1, 3), ARRIVE
    )
    expect(command.arrived).toBe(true)
    expect(command.throttle).toBe(false)
    expect(command.steer).toBe(0)
  })

  it('holds thrust and no steer at a target dead ahead', () => {
    const command = steerToward(
      new THREE.Vector3(0, 1, 0), hull(0), new THREE.Vector3(0, 1, 60), ARRIVE
    )
    expect(command.arrived).toBe(false)
    expect(command.throttle).toBe(true)
    expect(command.steer).toBeCloseTo(0, 5)
  })

  it('steers positive for a target to the right, negative to the left', () => {
    const from  = new THREE.Vector3(0, 1, 0)
    const right = steerToward(from, hull(0), new THREE.Vector3(60, 1, 60), ARRIVE)
    const left  = steerToward(from, hull(0), new THREE.Vector3(-60, 1, 60), ARRIVE)

    // `Controls.steer` is -1 left .. 1 right, and turning right increases the
    // compass bearing `bearingOf` reports — the sign the vehicle acts on.
    expect(right.steer).toBeGreaterThan(0)
    expect(left.steer).toBeLessThan(0)
    expect(right.steer).toBeCloseTo(-left.steer, 5)
  })

  it('turns on the spot rather than thrusting at a target behind it', () => {
    const command = steerToward(
      new THREE.Vector3(0, 1, 0), hull(0), new THREE.Vector3(0, 1, -60), ARRIVE
    )
    expect(command.throttle).toBe(false)
    expect(Math.abs(command.steer)).toBe(1)
  })

  it('reads the target through the hull’s own yaw', () => {
    // Ship facing +X; a target on +X is dead ahead, not 90 degrees off.
    const command = steerToward(
      new THREE.Vector3(0, 1, 0), hull(Math.PI * 0.5), new THREE.Vector3(60, 1, 0), ARRIVE
    )
    expect(command.steer).toBeCloseTo(0, 5)
    expect(command.throttle).toBe(true)
  })

  it('ignores height: a target far above is still dead ahead', () => {
    const command = steerToward(
      new THREE.Vector3(0, 1, 0), hull(0), new THREE.Vector3(0, 90, 60), ARRIVE
    )
    expect(command.steer).toBeCloseTo(0, 5)
    expect(command.throttle).toBe(true)
  })
})

describe('angle helpers', () => {
  it('wraps the short way round', () => {
    expect(angleDelta(3.0, -3.0)).toBeCloseTo(Math.PI * 2 - 6, 5)
    expect(angleDelta(0, Math.PI * 0.5)).toBeCloseTo(Math.PI * 0.5, 5)
  })

  it('measures bearing the way the instruments do', () => {
    expect(bearingOf(new THREE.Vector3(0, 0, 1))).toBeCloseTo(0, 5)
    expect(bearingOf(new THREE.Vector3(1, 0, 0))).toBeCloseTo(Math.PI * 0.5, 5)
  })
})
