import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-compat'
import type { DevDeps, OverlayFlags } from './types'


/**
 * Visual debug layers.
 *
 * All of these answer questions a screenshot of the finished render cannot:
 * where the colliders actually are versus where the art suggests they are,
 * whether the suspension rays are reaching the surface, and whether the ship
 * has driven out of the shadow frustum — which per this repo's history is a
 * recurring failure, not a hypothetical one.
 *
 * Every layer is one `LineSegments`, so the whole overlay set costs a handful
 * of draw calls no matter how much geometry the world has.
 */

/** Chosen so the overlay reads on both the neon and the dark-space backgrounds. */
const WHEEL_COLOUR   = 0x00ff9c
const CONTACT_COLOUR = 0xff3366
const PATH_COLOUR    = 0xffd166

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
  const wheelLines    = makeLines(WHEEL_COLOUR, 64)
  const contactLines  = makeLines(CONTACT_COLOUR, 256)
  const pathLine      = new THREE.Line(
    new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(PATH_CAPACITY * 3), 3)),
    new THREE.LineBasicMaterial({ color: PATH_COLOUR, transparent: true, opacity: 0.8, depthTest: false })
  )
  pathLine.frustumCulled = false
  pathLine.renderOrder   = 999
  pathLine.visible       = false

  let frustumHelper: THREE.CameraHelper | null = null
  let pathLength                               = 0
  let frameCount                               = 0

  scene.add(colliderLines, wheelLines, contactLines, pathLine)

  const _v      = new THREE.Vector3()
  const _n      = new THREE.Vector3()
  const _quat   = new THREE.Quaternion()
  const _origin = new THREE.Vector3()

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
    position.array.set(buffers.vertices)
    // Rapier emits RGBA; three's vertex colours want RGB, so drop every alpha.
    for (let i = 0; i < count; i++) {
      const c      = colour.array as Float32Array
      c[i * 3]     = buffers.colors[i * 4]
      c[i * 3 + 1] = buffers.colors[i * 4 + 1]
      c[i * 3 + 2] = buffers.colors[i * 4 + 2]
    }
    position.needsUpdate = true
    colour.needsUpdate   = true
    colliderLines.geometry.setDrawRange(0, count)
  }

  function drawWheels () {
    const controller = vehicle.current?.controller
    const body       = vehicle.current?.body
    const position   = wheelLines.geometry.getAttribute('position') as THREE.BufferAttribute
    const array      = position.array as Float32Array
    let cursor       = 0

    if (!controller || !body) {
      wheelLines.geometry.setDrawRange(0, 0)
      return
    }

    const t = body.translation()
    const r = body.rotation()
    _origin.set(t.x, t.y, t.z)
    _quat.set(r.x, r.y, r.z, r.w)

    const push = (a: THREE.Vector3, b: THREE.Vector3) => {
      array.set([ a.x, a.y, a.z, b.x, b.y, b.z ], cursor)
      cursor += 6
    }

    for (let i = 0; i < controller.numWheels(); i++) {
      const connection = controller.wheelChassisConnectionPointCs(i)
      const direction  = controller.wheelDirectionCs(i)
      if (!connection || !direction)
        continue

      // Connection points are chassis-space; the overlay draws in world space.
      _v.set(connection.x, connection.y, connection.z).applyQuaternion(_quat)
        .add(_origin)

      const length = controller.wheelSuspensionLength(i) ?? controller.wheelSuspensionRestLength(i) ?? 0
      _n.set(direction.x, direction.y, direction.z).applyQuaternion(_quat)
        .multiplyScalar(length)
      push(_v, _n.add(_v))

      // Contact normal at the wheel — the number the hover force is derived from.
      const point  = controller.wheelContactPoint(i)
      const normal = controller.wheelContactNormal(i)
      if (controller.wheelIsInContact(i) && point && normal) {
        _v.set(point.x, point.y, point.z)
        _n.set(normal.x, normal.y, normal.z).multiplyScalar(0.6)
          .add(_v)
        push(_v, _n)
      }
    }

    position.needsUpdate = true
    wheelLines.geometry.setDrawRange(0, cursor / 3)
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
      wheelLines.visible    = !!active.wheels
      contactLines.visible  = !!active.contacts
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
      if (active.wheels)
        drawWheels()
      if (active.contacts)
        drawContacts()
      if (active.path)
        drawPath(shipPosition)
      if (frustumHelper)
        frustumHelper.update()
    },

    dispose () {
      for (const object of [ colliderLines, wheelLines, contactLines, pathLine ]) {
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
