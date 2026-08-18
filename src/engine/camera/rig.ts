import * as THREE from 'three'
import { createFollowCamera } from 'threejs-scene'
import type { SeededRng } from 'threejs-scene'

// Camera feel — the original framerate-independent damping RATES, in `1 - exp(-k*dt)`.
const CAM_YAW_STIFFNESS  = 4
const CAM_POS_STIFFNESS  = 12
const CAM_LOOK_STIFFNESS = 10

/**
 * `createFollowCamera` damps with a half-life in `1 - 2^(-dt/h)`, not a rate in
 * `1 - exp(-k*dt)`. The two agree at h = ln2 / k, so the original feel is
 * preserved by converting rather than by passing the rates through.
 */
const halfLife = (rate: number) => Math.LN2 / rate

/** Seconds for a full chase <-> cockpit swap. */
const TRANSITION_S = 0.55

/** Half-life for easing the look-around pan toward its target. */
const PAN_HALF_LIFE = 0.18

export type CameraView = 'chase' | 'cockpit'

/**
 * A camera preset. Everything that differs between the two views lives here, so
 * the transition is a lerp over this record rather than a branch.
 *
 * `offset` and `lookOffset` are in the SHIP's local space, and the ship's
 * forward axis is +Z (see the `_fwd` extraction in `drive`).
 */
type Station = {
  offset:          readonly [number, number, number];
  lookOffset:      readonly [number, number, number];
  positionDamping: number;
  lookDamping:     number;
  fov:             number;

  /**
   * 0 feeds the rig a yaw-only quaternion and keeps `camera.up` on world up, so
   * the horizon stays level however the hull banks. 1 feeds the full hull
   * orientation and rolls the camera with it. Anything between is the swap.
   */
  hullBlend: number;

  /** Maximum look-around swing, radians. */
  panYaw:   number;
  panPitch: number;

  /** Impact shake multiplier — a shake that reads well from outside is far too much in a seat. */
  shakeScale: number;
}

/**
 * `lookOffset: [0, 0.8, 0]` is exactly the old `lookAhead: 0.8`.
 *
 * `lookAhead` aims at `target + WORLD_UP * lookAhead`; a local look offset aims
 * at `target + localLook.applyQuaternion(q)`. Because this station feeds a
 * yaw-only quaternion, and Y is invariant under a rotation about Y, the two are
 * the same point. Saying it the local way costs nothing and puts both stations
 * in the same aiming mode, which is what makes the transition a plain lerp
 * instead of a discontinuous mode flip.
 */
const CHASE: Station = {
  offset:          [ 0, 3.4, -9 ],
  lookOffset:      [ 0, 0.8, 0 ],
  positionDamping: halfLife(CAM_POS_STIFFNESS),
  lookDamping:     halfLife(CAM_LOOK_STIFFNESS),
  fov:             40,
  hullBlend:       0,
  panYaw:          0.10,
  panPitch:        0.06,
  shakeScale:      1,
}

/**
 * Seated at the canopy, aimed down the nose.
 *
 * `positionDamping: 0` is not a tuning choice. Exponential smoothing against a
 * moving target leaves a steady-state lag of roughly speed x half-life; a chase
 * camera wants that lag because it reads as weight, but a camera bolted inside
 * the hull would trail out through the back of it at speed.
 */
const COCKPIT: Station = {
  offset:          [ 0, 0.78, 0.55 ],
  lookOffset:      [ 0, 0.72, 24 ],
  positionDamping: 0,
  lookDamping:     0.02,
  fov:             62,
  hullBlend:       1,
  panYaw:          0.34,
  panPitch:        0.20,
  shakeScale:      0.35,
}

const _fwd       = new THREE.Vector3()
const _yawQuat   = new THREE.Quaternion()
const _blendQuat = new THREE.Quaternion()
const _hullUp    = new THREE.Vector3()
const _nextUp    = new THREE.Vector3()
const _shake     = new THREE.Vector3()
const _panEuler  = new THREE.Euler(0, 0, 0, 'YXZ')
const _panQuat   = new THREE.Quaternion()
const WORLD_UP   = new THREE.Vector3(0, 1, 0)

// Mutated in place and handed to `rig.aim` each frame — `aim` spreads them into
// its own vectors, so reusing these keeps the per-frame path allocation-free.
const _offset: [number, number, number]     = [ 0, 0, 0 ]
const _lookOffset: [number, number, number] = [ 0, 0, 0 ]
const _station                              = {
  offset:          _offset,
  lookOffset:      _lookOffset,
  positionDamping: 0,
  lookDamping:     0,
}

const lerp       = THREE.MathUtils.lerp
const smoothstep = (t: number) => t * t * (3 - 2 * t)

/** Look-around input, -1..1 on each axis. Structurally satisfied by `Controls`. */
export type CameraPan = { panX: number; panY: number }

export type CameraRig = {
  camera: THREE.PerspectiveCamera;

  /** Advance the rig. Call from the RENDER phase with the real delta and the interpolated pose. */
  drive(realDelta: number, position: THREE.Vector3, quaternion: THREE.Quaternion, pan: CameraPan): void;

  /** Cut to the target immediately — spawn, respawn, teleport. */
  requestSnap(): void;

  /** Kick a decaying impact shake. */
  shake(amount: number): void;

  setView(view: CameraView): void;
  toggleView(): void;
  view(): CameraView;

  /** 0 = fully chase, 1 = fully seated. Drives HUD cross-fade and hull visibility. */
  blend(): number;
}

/**
 * The race camera: a third-person chase rig and a cockpit seat, as two stations
 * of one damped follow camera.
 *
 * There is deliberately only ONE `PerspectiveCamera` here. `createApp` binds the
 * camera it is given to its resize observer at construction, so a second camera
 * swapped in later would never have its aspect corrected.
 */
/**
 * @param far - Far plane. The race tracks fit inside 400; the battle deck is
 * 600 units across and needs its far wall to survive the frustum cull.
 */
export function createCameraRig (rng: SeededRng, far = 400): CameraRig {
  const shakeRng = rng.fork('camera-shake')

  const rig = createFollowCamera({
    offset:          [ ...CHASE.offset ],
    lookOffset:      [ ...CHASE.lookOffset ],
    positionDamping: CHASE.positionDamping,
    lookDamping:     CHASE.lookDamping,
    fov:             CHASE.fov,
    near:            0.1,
    far,
  })

  let camYaw: number | null = null
  let snapRequested         = true

  let target = 0 // 0 = chase, 1 = cockpit
  let raw    = 0 // linear transition parameter, eased on read

  // Eased pan, so a flicked mouse does not snap the view.
  let panX = 0
  let panY = 0

  /** Last applied shake, subtracted before the next update so it never feeds back. */
  const lastShake = new THREE.Vector3()
  let shakeAmount = 0

  return {
    camera: rig.camera,

    requestSnap () {
      snapRequested = true
      shakeAmount = 0
    },

    shake (amount) {
      shakeAmount = Math.max(shakeAmount, amount)
    },

    setView (view) {
      target = view === 'cockpit' ? 1 : 0
    },

    toggleView () {
      target = target > 0.5 ? 0 : 1
    },

    view () {
      return target > 0.5 ? 'cockpit' : 'chase'
    },

    blend () {
      return smoothstep(raw)
    },

    drive (realDelta, position, quaternion, pan) {
      // --- transition ------------------------------------------------------
      const step = realDelta / TRANSITION_S
      if (raw < target)
        raw = Math.min(target, raw + step)
      else if (raw > target)
        raw = Math.max(target, raw - step)

      const e = smoothstep(raw)

      // --- orientation source ---------------------------------------------
      _fwd.set(0, 0, 1).applyQuaternion(quaternion)

      const shipYaw = Math.atan2(_fwd.x, _fwd.z)

      if (camYaw === null || snapRequested)
        camYaw = shipYaw
      else {
        let deltaYaw = shipYaw - camYaw
        deltaYaw = Math.atan2(Math.sin(deltaYaw), Math.cos(deltaYaw)) // wrap to [-pi, pi]
        camYaw += deltaYaw * (1 - Math.exp(-CAM_YAW_STIFFNESS * realDelta))
      }

      _yawQuat.setFromAxisAngle(WORLD_UP, camYaw)
      _blendQuat.slerpQuaternions(_yawQuat, quaternion, e)

      // `FollowCamera.update` ends in `camera.lookAt`, which honours `camera.up`.
      // Blending up from world to hull is therefore the whole of the cockpit
      // roll — no extra machinery, and chase keeps its level horizon at e = 0.
      _hullUp.set(0, 1, 0).applyQuaternion(quaternion)
      _nextUp.copy(WORLD_UP).lerp(_hullUp, e)

      // lookAt degenerates when up is parallel to the view direction. It cannot
      // happen at e = 1 (hull up and hull forward are orthogonal by
      // construction) but the blend can graze it on a steep climb.
      if (_nextUp.lengthSq() > 1e-6) {
        _nextUp.normalize()
        if (Math.abs(_nextUp.dot(_fwd)) < 0.999)
          rig.camera.up.copy(_nextUp)
      }

      // --- station ---------------------------------------------------------
      for (let i = 0; i < 3; i++) {
        _offset[i]     = lerp(CHASE.offset[i], COCKPIT.offset[i], e)
        _lookOffset[i] = lerp(CHASE.lookOffset[i], COCKPIT.lookOffset[i], e)
      }
      _station.positionDamping = lerp(CHASE.positionDamping, COCKPIT.positionDamping, e)
      _station.lookDamping     = lerp(CHASE.lookDamping, COCKPIT.lookDamping, e)
      rig.aim(_station)

      const fov = lerp(CHASE.fov, COCKPIT.fov, e)
      if (Math.abs(rig.camera.fov - fov) > 1e-4) {
        rig.camera.fov = fov
        rig.camera.updateProjectionMatrix()
      }

      // --- solve -----------------------------------------------------------
      // The rig lerps from the camera's CURRENT position, so last frame's shake
      // would be smoothed into the settled pose and drift the whole rig. Remove
      // it, let the rig settle clean, then re-apply.
      rig.camera.position.sub(lastShake)

      if (snapRequested) {
        rig.snap(position, _blendQuat)
        snapRequested = false
      }
      else
        rig.update(position, _blendQuat, realDelta)

      const shakeScale = lerp(CHASE.shakeScale, COCKPIT.shakeScale, e)

      if (shakeAmount > 0.001) {
        const magnitude = shakeAmount * shakeScale
        _shake.set(
          (shakeRng.next() - 0.5) * magnitude * 2,
          (shakeRng.next() - 0.5) * magnitude * 2,
          (shakeRng.next() - 0.5) * magnitude * 2
        )
        shakeAmount *= Math.exp(-realDelta * 6)
      }
      else {
        _shake.set(0, 0, 0)
        shakeAmount = 0
      }

      rig.camera.position.add(_shake)
      lastShake.copy(_shake)

      // --- look-around pan --------------------------------------------------
      // Rotation only, and applied AFTER the solve. A positional pan would be
      // read back by `camera.position.lerp` on the next frame and walk the whole
      // rig off its offset — the same feedback the shake works around above.
      const k = 1 - Math.pow(2, -realDelta / PAN_HALF_LIFE)
      panX += (pan.panX - panX) * k
      panY += (pan.panY - panY) * k

      const panYaw   = lerp(CHASE.panYaw, COCKPIT.panYaw, e)
      const panPitch = lerp(CHASE.panPitch, COCKPIT.panPitch, e)

      // +Y is a left turn, so a rightward pointer yaws negative.
      _panEuler.set(-panY * panPitch, -panX * panYaw, 0)
      _panQuat.setFromEuler(_panEuler)
      rig.camera.quaternion.multiply(_panQuat)
    },
  }
}

// perf: allocation-free per frame — all scratch is hoisted, the station handed to
// `aim` is mutated in place, and the shake uses a forked seeded rng rather than
// Math.random so a replay reproduces exactly.
