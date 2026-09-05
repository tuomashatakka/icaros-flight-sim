import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import RapierNS from '@dimforge/rapier3d-compat'
import { vehicleConfig } from '@/lib/utils'
import {
  FORCE_COLOURS,
  FORCE_SCALE,
  MAX_ARROW,
  NET_FORCE_COLOUR,
  NET_TORQUE_COLOUR,
  TORQUE_SCALE,
} from '../fx/vectors'
import { INERTIA, THRUSTER_RIG } from '@crash-velocity/physics/thrusters'
import type { DevDeps, OverlayFlags } from './types'


/**
 * Visual debug layers.
 *
 * All of these answer questions a screenshot of the finished render cannot:
 * where the colliders actually are versus where the art suggests they are,
 * whether the hover rays are reaching the surface, and — since the ship became
 * a thruster rig — which nozzle is actually firing and what the sum of every
 * force on the hull adds up to. A handling bug is almost always one arrow
 * pointing somewhere indefensible, and it is much faster to see that than to
 * infer it from a velocity trace.
 *
 * Every layer is one `LineSegments`, so the whole set costs a handful of draw
 * calls no matter how much geometry the world has.
 */

/** Chosen so the overlay reads on both the neon and the dark-space backgrounds. */
const RAY_COLOUR     = 0x00ff9c
const CONTACT_COLOUR = 0xff3366
const PATH_COLOUR    = 0xffd166


/** Half-extents of the little cross drawn at each thruster mount. */
const CROSS_AXES = [
  new THREE.Vector3(0.09, 0, 0),
  new THREE.Vector3(0, 0.09, 0),
  new THREE.Vector3(0, 0, 0.09),
] as const

/** Body axis triad: X red, Y green, Z blue, forward drawn longest. */
const COM_AXES = [
  [ new THREE.Vector3(1.2, 0, 0), 0xff4d6d ],
  [ new THREE.Vector3(0, 1.2, 0), 0x80ed99 ],
  [ new THREE.Vector3(0, 0, 1.6), 0x4cc9f0 ],
] as const

const VELOCITY_COLOUR = 0x48cae4
const ANGVEL_COLOUR   = 0xffb703


/** Ship positions kept for the path polyline — ~30 s at the sampling rate below. */
const PATH_CAPACITY = 900

/** Collider wireframes only change when bodies move; 4 Hz is plenty and it is the expensive one. */
const COLLIDER_REFRESH = 4

export type Overlays = {
  set (flags: OverlayFlags): OverlayFlags;
  flags (): OverlayFlags;

  /** Call from the render phase with the interpolated ship pose. */
  update (shipPosition: THREE.Vector3): void;
  dispose (): void;
}

function makeLines (colour: number | null, capacity: number): THREE.LineSegments {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3))
  if (colour === null)
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3))

  const material = new THREE.LineBasicMaterial(
    colour === null
      ? { vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 }
      : { color: colour, depthTest: false, transparent: true, opacity: 0.9 }
  )

  const lines = new THREE.LineSegments(geometry, material)
  // Overlays must survive the camera driving away from the origin; without this
  // three's frustum culling hides them the moment the (stale) bounding sphere
  // leaves view, which reads as "the overlay is broken".
  lines.frustumCulled = false
  lines.renderOrder   = 999
  lines.visible       = false
  return lines
}

export function createOverlays (deps: DevDeps): Overlays {
  const { physics, vehicle, sun, app } = deps
  const scene                          = app.ctx.scene

  const active: OverlayFlags = {}

  const colliderLines = makeLines(null, 20000)
  const rayLines      = makeLines(RAY_COLOUR, 128)
  const contactLines  = makeLines(CONTACT_COLOUR, 256)
  const forceLines    = makeLines(null, 2048)
  const netLines      = makeLines(null, 128)
  const thrusterLines = makeLines(null, 512)
  const comLines      = makeLines(null, 64)
  const velocityLines = makeLines(null, 64)
  const inertiaLines  = makeLines(null, 768)

  const pathLine = new THREE.Line(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(PATH_CAPACITY * 3), 3)),
    new THREE.LineBasicMaterial({ color: PATH_COLOUR, transparent: true, opacity: 0.8, depthTest: false })
  )
  pathLine.frustumCulled = false
  pathLine.renderOrder   = 999
  pathLine.visible       = false

  let frustumHelper: THREE.CameraHelper | null = null
  let pathLength                               = 0
  let frameCount                               = 0

  const allLines = [
    colliderLines, rayLines, contactLines, forceLines,
    netLines, thrusterLines, comLines, velocityLines, inertiaLines,
  ]
  scene.add(...allLines, pathLine)

  const _v = new THREE.Vector3()
  const _n = new THREE.Vector3()
  const _a = new THREE.Vector3()
  const _b = new THREE.Vector3()

  // `arrow()` gets its OWN scratch and touches nothing else. It used to share
  // `_b`/`_perp` with its callers, so drawing the first axis of the COM triad
  // silently overwrote the vectors holding the other two and the overlay drew a
  // triad that was not the ship's.
  const _tip    = new THREE.Vector3()
  const _shaft  = new THREE.Vector3()
  const _barb   = new THREE.Vector3()
  const _side   = new THREE.Vector3()
  const _perp   = new THREE.Vector3()
  const _dir    = new THREE.Vector3()
  const _quat   = new THREE.Quaternion()
  const _origin = new THREE.Vector3()
  const _colour = new THREE.Color()
  const _ray    = new RapierNS.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })

  /**
   * A cursor over one line buffer, in vertex-pair units.
   *
   * Every layer below writes through one of these instead of hand-indexing, so
   * "did I remember to bump the cursor by six" stops being a class of bug.
   */
  function writer (lines: THREE.LineSegments) {
    const position = lines.geometry.getAttribute('position') as THREE.BufferAttribute
    const colour   = lines.geometry.getAttribute('color') as THREE.BufferAttribute | undefined
    const pos      = position.array as Float32Array
    const col      = colour?.array as Float32Array | undefined
    const capacity = position.count
    let cursor     = 0

    return {
      segment (a: THREE.Vector3, b: THREE.Vector3, hex: number) {
        if (cursor + 2 > capacity)
          return
        pos.set([ a.x, a.y, a.z, b.x, b.y, b.z ], cursor * 3)
        if (col) {
          _colour.setHex(hex)
          col.set([ _colour.r, _colour.g, _colour.b, _colour.r, _colour.g, _colour.b ], cursor * 3)
        }
        cursor += 2
      },

      /** Shaft plus two barbs. Degenerate vectors are skipped, not drawn as dots. */
      arrow (from: THREE.Vector3, vector: THREE.Vector3, hex: number) {
        const length = vector.length()
        if (length < 1e-3)
          return

        _tip.copy(from).add(vector)
        this.segment(from, _tip, hex)

        _dir.copy(vector).multiplyScalar(1 / length)
        // Any perpendicular will do; cross with world up unless the vector IS up.
        _perp.set(0, 1, 0)
        if (Math.abs(_dir.y) > 0.95)
          _perp.set(1, 0, 0)
        _side.crossVectors(_dir, _perp).normalize()

        const head = Math.min(length * 0.22, 0.9)
        _shaft.copy(_tip).addScaledVector(_dir, -head)
        this.segment(_tip, _barb.copy(_shaft).addScaledVector(_side, head * 0.45), hex)
        this.segment(_tip, _barb.copy(_shaft).addScaledVector(_side, -head * 0.45), hex)
      },

      done () {
        position.needsUpdate = true
        if (colour)
          colour.needsUpdate = true
        lines.geometry.setDrawRange(0, cursor)
      },
    }
  }

  /** Load the ship's world pose into the shared scratch. False when there is none. */
  function shipPose (): boolean {
    const body = vehicle.current?.body
    if (!body)
      return false

    const t = body.translation()
    const r = body.rotation()
    _origin.set(t.x, t.y, t.z)
    _quat.set(r.x, r.y, r.z, r.w)
    return true
  }

  /**
   * Grow a line buffer in place rather than reallocating each frame.
   *
   * The collider buffer is sized for a typical level, but `procedural` can
   * exceed it — silently truncating would draw a half-finished wireframe that
   * looks like missing collision, which is exactly the bug this overlay exists
   * to rule out.
   */
  function ensureCapacity (lines: THREE.LineSegments, needed: number) {
    const attribute = lines.geometry.getAttribute('position') as THREE.BufferAttribute
    if (attribute.count >= needed)
      return

    const grown = Math.ceil(needed * 1.5)
    lines.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(grown * 3), 3))
    if (lines.geometry.getAttribute('color'))
      lines.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(grown * 3), 3))
  }

  function drawColliders () {
    const buffers = physics.world.debugRender()
    const count   = buffers.vertices.length / 3

    ensureCapacity(colliderLines, count)

    const position = colliderLines.geometry.getAttribute('position') as THREE.BufferAttribute
    const colour   = colliderLines.geometry.getAttribute('color') as THREE.BufferAttribute
    const colours  = colour.array as Float32Array;
    (position.array as Float32Array).set(buffers.vertices)
    // Rapier emits RGBA; three's vertex colours want RGB, so drop every alpha.
    for (let i = 0; i < count; i++) {
      colours[i * 3]     = buffers.colors[i * 4]
      colours[i * 3 + 1] = buffers.colors[i * 4 + 1]
      colours[i * 3 + 2] = buffers.colors[i * 4 + 2]
    }

    position.needsUpdate = true
    colour.needsUpdate   = true
    colliderLines.geometry.setDrawRange(0, count)
  }

  /**
   * The four hover rays, re-cast here rather than reported out of the sim.
   *
   * Recasting costs four rays a frame in a dev build and keeps the sim's return
   * type from growing a field only a debug layer reads. The ray LENGTH uses the
   * config rest height rather than live tuning, so a tuned-down float draws a
   * slightly long shaft — the hit point and normal are still exact.
   */
  function drawRays () {
    const w    = writer(rayLines)
    const body = vehicle.current?.body
    if (!body || !shipPose()) {
      w.done()
      return
    }

    _n.set(0, 1, 0).applyQuaternion(_quat)

    const maxToi = vehicleConfig.hoverHeight + vehicleConfig.suspensionTravel

    for (const thruster of THRUSTER_RIG) {
      if (thruster.group !== 'lift')
        continue

      _v.set(thruster.pos[0], thruster.pos[1], thruster.pos[2]).applyQuaternion(_quat)
        .add(_origin)
      _ray.origin.x = _v.x
      _ray.origin.y = _v.y
      _ray.origin.z = _v.z
      _ray.dir.x    = -_n.x
      _ray.dir.y    = -_n.y
      _ray.dir.z    = -_n.z

      const hit = physics.world.castRayAndGetNormal(_ray, maxToi, true, RapierNS.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, body)
      const toi = hit ? hit.timeOfImpact : maxToi
      w.segment(_v, _b.copy(_v).addScaledVector(_n, -toi), RAY_COLOUR)

      if (hit) {
        _a.copy(_v).addScaledVector(_n, -toi)
        _b.set(hit.normal.x, hit.normal.y, hit.normal.z).multiplyScalar(0.8)
          .add(_a)
        w.segment(_a, _b, CONTACT_COLOUR)
      }
    }

    w.done()
  }

  /** One arrow per force the sim actually applied, at the point it applied it. */
  function drawForces () {
    const w      = writer(forceLines)
    const forces = vehicle.current?.debug?.forces
    if (!forces) {
      w.done()
      return
    }

    for (const force of forces) {
      _v.set(force.point[0], force.point[1], force.point[2])
      _n.set(force.vector[0], force.vector[1], force.vector[2]).multiplyScalar(FORCE_SCALE)
      if (_n.length() > MAX_ARROW)
        _n.setLength(MAX_ARROW)
      w.arrow(_v, _n, FORCE_COLOURS[force.group] ?? 0xffffff)
    }

    w.done()
  }

  /**
   * The sum. White is net force, red is net torque.
   *
   * This is the one that settles arguments: in steady cruise the white arrow
   * should be near zero, and any time the ship is doing something you did not
   * ask for, it is pointing at the reason.
   */
  function drawNet () {
    const w     = writer(netLines)
    const debug = vehicle.current?.debug
    if (!debug || !shipPose()) {
      w.done()
      return
    }

    _n.set(debug.netForce[0], debug.netForce[1], debug.netForce[2]).multiplyScalar(FORCE_SCALE)
    if (_n.length() > MAX_ARROW)
      _n.setLength(MAX_ARROW)
    w.arrow(_origin, _n, NET_FORCE_COLOUR)

    _n.set(debug.netTorque[0], debug.netTorque[1], debug.netTorque[2]).multiplyScalar(TORQUE_SCALE)
    if (_n.length() > MAX_ARROW)
      _n.setLength(MAX_ARROW)
    w.arrow(_origin, _n, NET_TORQUE_COLOUR)

    w.done()
  }

  /** Static rig geometry — every mount and nozzle direction, firing or not. */
  function drawThrusters () {
    const w = writer(thrusterLines)
    if (!shipPose()) {
      w.done()
      return
    }

    for (const thruster of THRUSTER_RIG) {
      const hex = FORCE_COLOURS[thruster.group]
      _v.set(thruster.pos[0], thruster.pos[1], thruster.pos[2]).applyQuaternion(_quat)
        .add(_origin)
      _n.set(thruster.dir[0], thruster.dir[1], thruster.dir[2]).applyQuaternion(_quat)
        .multiplyScalar(0.55)
      w.arrow(_v, _n, hex)

      // A cross at the mount, so the point the torque arm is measured from is
      // visible even when the nozzle direction is edge-on to the camera.
      for (const axis of CROSS_AXES) {
        _a.copy(axis).applyQuaternion(_quat)
        w.segment(_b.copy(_v).sub(_a), _n.copy(_v).add(_a), hex)
      }
    }

    w.done()
  }

  /** Centre of mass and the body axis triad the thruster arms are measured in. */
  function drawCom () {
    const w = writer(comLines)
    if (!shipPose()) {
      w.done()
      return
    }

    for (const [ axis, hex ] of COM_AXES) {
      _n.copy(axis).applyQuaternion(_quat)
      w.arrow(_origin, _n, hex)
    }

    w.done()
  }

  /** Linear velocity (m/s, 1:1) and the angular velocity axis. */
  function drawVelocity () {
    const w    = writer(velocityLines)
    const body = vehicle.current?.body
    if (!body || !shipPose()) {
      w.done()
      return
    }

    const lv = body.linvel()
    const av = body.angvel()
    w.arrow(_origin, _n.set(lv.x, lv.y, lv.z).multiplyScalar(0.25), VELOCITY_COLOUR)
    w.arrow(_origin, _n.set(av.x, av.y, av.z).multiplyScalar(1.6), ANGVEL_COLOUR)
    w.done()
  }

  /**
   * The inertia ellipsoid, as three body-plane rings.
   *
   * Worth having on screen because it is the half of `tau = I * alpha` that is
   * invisible everywhere else: roll is nearly seven times cheaper to accelerate
   * than yaw on this hull, and that asymmetry explains most of how it feels.
   */
  function drawInertia () {
    const w = writer(inertiaLines)
    if (!shipPose()) {
      w.done()
      return
    }

    const max = Math.max(INERTIA.pitch, INERTIA.yaw, INERTIA.roll)
    const rx  = Math.sqrt(INERTIA.pitch / max) * 1.6
    const ry  = Math.sqrt(INERTIA.yaw / max) * 1.6
    const rz  = Math.sqrt(INERTIA.roll / max) * 1.6

    const SEGMENTS                                               = 24
    const rings: Array<[number, number, number, number, number]> = [
      [ 0, 2, rz, rx, 0xff4d6d ], // pitch plane (YZ)
      [ 0, 1, rz, ry, 0x80ed99 ], // yaw plane   (XZ)
      [ 1, 2, ry, rx, 0x4cc9f0 ], // roll plane  (XY)
    ]

    for (const [ axisA, axisB, radA, radB, hex ] of rings)
      for (let i = 0; i < SEGMENTS; i++) {
        const t0 = i / SEGMENTS * Math.PI * 2
        const t1 = (i + 1) / SEGMENTS * Math.PI * 2
        _a.set(0, 0, 0)
        _a.setComponent(axisA, Math.cos(t0) * radA)
        _a.setComponent(axisB, Math.sin(t0) * radB)
        _b.set(0, 0, 0)
        _b.setComponent(axisA, Math.cos(t1) * radA)
        _b.setComponent(axisB, Math.sin(t1) * radB)
        w.segment(
          _a.applyQuaternion(_quat).add(_origin),
          _b.applyQuaternion(_quat).add(_origin),
          hex
        )
      }

    w.done()
  }

  function drawContacts () {
    const body     = vehicle.current?.body
    const position = contactLines.geometry.getAttribute('position') as THREE.BufferAttribute
    const array    = position.array as Float32Array
    let cursor     = 0

    if (!body) {
      contactLines.geometry.setDrawRange(0, 0)
      return
    }

    const capacity = position.count * 3
    for (let i = 0; i < body.numColliders(); i++) {
      const collider = body.collider(i)
      physics.world.contactPairsWith(collider, other => {
        physics.world.contactPair(collider, other, (manifold: RAPIER.TempContactManifold, flipped: boolean) => {
          const normal = manifold.normal()
          for (let p = 0; p < manifold.numSolverContacts(); p++) {
            if (cursor + 6 > capacity)
              return

            const point = manifold.solverContactPoint(p)
            if (!point)
              continue

            const sign      = flipped ? -1 : 1
            array[cursor++] = point.x
            array[cursor++] = point.y
            array[cursor++] = point.z
            array[cursor++] = point.x + normal.x * sign
            array[cursor++] = point.y + normal.y * sign
            array[cursor++] = point.z + normal.z * sign
          }
        })
      })
    }

    position.needsUpdate = true
    contactLines.geometry.setDrawRange(0, cursor / 3)
  }

  function drawPath (shipPosition: THREE.Vector3) {
    const position = pathLine.geometry.getAttribute('position') as THREE.BufferAttribute
    const array    = position.array as Float32Array

    if (pathLength >= PATH_CAPACITY) {
      array.copyWithin(0, 3)
      pathLength = PATH_CAPACITY - 1
    }
    array[pathLength * 3]     = shipPosition.x
    array[pathLength * 3 + 1] = shipPosition.y
    array[pathLength * 3 + 2] = shipPosition.z
    pathLength++

    position.needsUpdate = true
    pathLine.geometry.setDrawRange(0, pathLength)
  }

  return {
    set (flags) {
      Object.assign(active, flags)

      colliderLines.visible = !!active.colliders
      rayLines.visible      = !!active.rays
      contactLines.visible  = !!active.contacts
      forceLines.visible    = !!active.forces
      netLines.visible      = !!active.netForce
      thrusterLines.visible = !!active.thrusters
      comLines.visible      = !!active.com
      velocityLines.visible = !!active.velocity
      inertiaLines.visible  = !!active.inertia
      pathLine.visible      = !!active.path

      if (active.path === false)
        pathLength = 0

      // The shadow camera is owned by the sun module and only exists after it
      // builds, so the helper is created lazily rather than at overlay setup.
      if (active.frustum && !frustumHelper) {
        const light = sun.current?.light
        if (light) {
          frustumHelper = new THREE.CameraHelper(light.shadow.camera)
          frustumHelper.renderOrder = 999
          scene.add(frustumHelper)
        }
      }
      if (!active.frustum && frustumHelper) {
        frustumHelper.removeFromParent()
        frustumHelper.dispose()
        frustumHelper = null
      }

      return { ...active }
    },

    flags () {
      return { ...active }
    },

    update (shipPosition) {
      frameCount++
      if (active.colliders && frameCount % COLLIDER_REFRESH === 0)
        drawColliders()
      if (active.rays)
        drawRays()
      if (active.contacts)
        drawContacts()
      if (active.forces)
        drawForces()
      if (active.netForce)
        drawNet()
      if (active.thrusters)
        drawThrusters()
      if (active.com)
        drawCom()
      if (active.velocity)
        drawVelocity()
      if (active.inertia)
        drawInertia()
      if (active.path)
        drawPath(shipPosition)
      if (frustumHelper)
        frustumHelper.update()
    },

    dispose () {
      for (const object of [ ...allLines, pathLine ]) {
        object.removeFromParent()
        object.geometry.dispose();
        (object.material as THREE.Material).dispose()
      }
      if (frustumHelper) {
        frustumHelper.removeFromParent()
        frustumHelper.dispose()
        frustumHelper = null
      }
    },
  }
}
