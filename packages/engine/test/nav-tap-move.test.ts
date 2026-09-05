import * as THREE from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { attachTapMove } from 'Σnav/tap-move'
import type { TapMove } from 'Σnav/tap-move'
import { createControls } from 'Σinput'
import type { Controls } from 'Σinput'


/**
 * The tap path, end to end, without a browser or a live race.
 *
 * This exists because two attempts to verify tap-to-move in the running app
 * measured nothing at all: the networked race sits in `lobby` in a sandbox with
 * no database, and `packages/physics` gates thrust and steer behind
 * `allowDrive`, so NOTHING moves the ship there — a tapped goal and a plainly
 * forced `throttle` produced the same 0.1-odd units of drift. The sim's response
 * to `Controls` is `packages/physics`' business and has its own tests; what was
 * genuinely unverified is the chain this covers — a tap becomes a goal, and a
 * goal becomes the right `Controls`.
 */

type Listener = (event: PointerLike) => void

type PointerLike = {
  clientX:     number;
  clientY:     number;
  pointerType: string;
  timeStamp:   number;
}

/** A canvas stub that hands back the listeners it was given. */
function stubCanvas (width = 800, height = 450) {
  const listeners = new Map<string, Listener[]>()

  return {
    listeners,
    element: {
      addEventListener (type: string, listener: Listener) {
        const bucket = listeners.get(type) ?? []
        bucket.push(listener)
        listeners.set(type, bucket)
      },
      removeEventListener (type: string, listener: Listener) {
        listeners.set(type, (listeners.get(type) ?? []).filter(entry => entry !== listener))
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width, height }),
    } as unknown as HTMLCanvasElement,

    fire (type: string, event: PointerLike) {
      for (const listener of listeners.get(type) ?? [])
        listener(event)
    },
  }
}

/** A camera above and behind the origin, looking at it — the chase station. */
function chaseCamera (): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(63, 16 / 9, 0.1, 400)
  camera.position.set(0, 8, -18)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  camera.updateProjectionMatrix()
  return camera
}

describe('tap to move', () => {
  let canvas: ReturnType<typeof stubCanvas>
  let controls: Controls
  let scene: THREE.Scene
  let ship: THREE.Vector3
  let hull: THREE.Quaternion
  let tapMove: TapMove

  beforeEach(() => {
    canvas   = stubCanvas()
    controls = createControls()
    scene    = new THREE.Scene()
    ship     = new THREE.Vector3(0, 0.6, 0)
    hull     = new THREE.Quaternion()

    tapMove = attachTapMove({
      canvas:         canvas.element,
      controls,
      scene,
      camera:         () => chaseCamera(),
      shipPosition:   () => ship,
      hullQuaternion: () => hull,
      accepts:        pointerType => pointerType === 'touch',
    })
  })

  const tap = (x: number, y: number, pointerType = 'touch', held = 0) => {
    canvas.fire('pointerdown', { clientX: x, clientY: y, pointerType, timeStamp: 0 })
    canvas.fire('pointerup', { clientX: x, clientY: y, pointerType, timeStamp: held })
  }

  const marker = () => scene.getObjectByName('tap-move-target')!

  it('hangs a hidden marker in the scene until something is tapped', () => {
    expect(marker()).toBeDefined()
    expect(marker().visible).toBe(false)
  })

  it('does nothing at all before a tap', () => {
    tapMove.drive()
    expect(controls.throttle).toBe(false)
    expect(controls.steer).toBe(0)
  })

  it('turns a tap into a goal and thrusts toward it', () => {
    // The camera looks AT the ship, so screen centre IS the ship: ground above
    // centre is beyond it, ground below is between it and the camera. The
    // horizon sits near y=62 here, so 150 is ground, and in front.
    tap(300, 150)
    expect(marker().visible).toBe(true)

    tapMove.drive()
    expect(controls.throttle).toBe(true)
    expect(controls.throttleAxis).toBe(1)
  })

  it('steers the way the tap was, and the physics negates it into a real turn', () => {
    tap(700, 150)
    tapMove.drive()

    const right = controls.steer

    tapMove.clear()
    tap(100, 150)
    tapMove.drive()

    const left = controls.steer

    expect(right).not.toBeCloseTo(left, 3)
    expect(Math.sign(right)).toBe(-Math.sign(left))
  })

  it('turns on the spot rather than thrusting at a tap behind the ship', () => {
    // Ground below centre is between the camera and the ship. Arcing round to
    // it would overshoot and come back, which reads as ignoring the tap.
    tap(400, 380)
    tapMove.drive()

    expect(marker().visible).toBe(true)
    expect(controls.throttle).toBe(false)
    expect(Math.abs(controls.steer)).toBe(1)
  })

  it('ignores a drag — that is the look-around gesture', () => {
    canvas.fire('pointerdown', { clientX: 400, clientY: 150, pointerType: 'touch', timeStamp: 0 })
    canvas.fire('pointerup', { clientX: 460, clientY: 150, pointerType: 'touch', timeStamp: 90 })
    expect(marker().visible).toBe(false)

    tapMove.drive()
    expect(controls.throttle).toBe(false)
  })

  it('ignores a long press, and a pointer kind it was not given', () => {
    tap(300, 150, 'touch', 900)
    expect(marker().visible).toBe(false)

    tap(300, 150, 'mouse')
    expect(marker().visible).toBe(false)
  })

  it('forgets a cancelled pointer rather than reading the next release as a tap', () => {
    canvas.fire('pointerdown', { clientX: 120, clientY: 150, pointerType: 'touch', timeStamp: 0 })
    canvas.fire('pointercancel', { clientX: 120, clientY: 150, pointerType: 'touch', timeStamp: 10 })
    // A release on the far side of the screen: a tap only if the cancelled
    // start point were still standing.
    canvas.fire('pointerup', { clientX: 700, clientY: 150, pointerType: 'touch', timeStamp: 20 })
    expect(marker().visible).toBe(false)
  })

  it('releases the axes it was holding once it arrives', () => {
    tap(400, 150)
    tapMove.drive()
    expect(controls.throttle).toBe(true)

    // Teleport the ship onto its own goal.
    ship.copy(marker().position)
    tapMove.drive()

    expect(controls.throttle).toBe(false)
    expect(controls.throttleAxis).toBe(0)
    expect(controls.steer).toBe(0)
    expect(marker().visible).toBe(false)
  })

  it('leaves controls alone when it never had a goal to hold', () => {
    controls.steer    = 0.5
    controls.throttle = true
    tapMove.clear()

    // Not its axes to zero — a key or a thumb is holding these.
    expect(controls.steer).toBe(0.5)
    expect(controls.throttle).toBe(true)
  })

  it('unhooks and removes its marker on dispose', () => {
    tap(300, 150)
    tapMove.dispose()

    expect(scene.getObjectByName('tap-move-target')).toBeUndefined()
    expect(canvas.listeners.get('pointerdown')).toHaveLength(0)
  })
})
