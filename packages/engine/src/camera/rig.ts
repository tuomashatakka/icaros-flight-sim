import * as THREE from 'three'
import { createFollowCamera } from 'threejs-scene'
import type { SeededRng } from 'threejs-scene'
import { reducedMotion } from '../lifecycle'
import type { CameraView } from 'Ȼcamera'

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

/**
 * How much of the look-around swing the HUD anchor inherits, 0..1.
 *
 * The visor used to be frozen to the pre-pan station, so looking around slid
 * the camera across a stationary cockpit and the panels walked off the edge of
 * the screen. Carrying the full swing instead would bolt the HUD to the
 * sightline and put a panel over whatever you were looking at. At 0.6 the visor
 * leads the look — it drifts the way a helmet display does — while the target
 * still opens up between the panels.
 */
const HUD_LEAD = 0.6

/**
 * Felt motion: how the camera answers what the hull is doing.
 *
 * A camera bolted at a fixed offset reports the ship's position and nothing
 * about its effort — full boost and a coast look the same, and a wall is a
 * number on a gauge. These drive a damped spring in the ship's frame toward
 * `-accel * gain`, so the camera sags back under thrust, lurches in on the
 * brakes, swings out through a corner and dips on a landing, and overshoots a
 * little on the way back, which is what gives it weight.
 *
 * Gains are metres of offset per m/s^2. Full thrust is ~16 m/s^2 and boost
 * roughly doubles it; a flat-out corner pulls ~40 laterally, so the clamps are
 * what shape the top end.
 */
const MOTION = {
  longGain:    0.035,
  longBack:    1.5,
  longForward: 0.8,
  latGain:     0.022,
  latMax:      0.9,
  vertGain:    0.02,
  vertMax:     0.45,

  /** Spring natural frequency (rad/s) and damping ratio. Under-damped on purpose. */
  omega: 7.5,
  zeta:  0.58,

  /** Camera roll into a corner, radians per m/s^2 of lateral load, and its cap (~2.6 deg). */
  rollGain: 0.0014,
  rollMax:  0.045,

  /** FOV kick, degrees: at top speed, on boost, and per m/s^2 of surge. */
  fovSpeed: 3.5,
  fovBoost: 5,
  fovAccel: 0.12,
  fovMax:   9,

  /**
   * A collision: spring velocity per m/s^2 of contact acceleration, and how
   * much shake it buys. A wall at racing speed is several hundred m/s^2.
   */
  kickGain:  0.012,
  kickMax:   6,
  joltShake: 1 / 260,

  /** Seated, the head moves a fraction of what a boom-mounted camera can. */
  seatScale: 0.18,
} as const

/** Rotational shake, radians per unit of shake. Reads far stronger than translation at chase distance. */
const SHAKE_TILT = 0.014

export type { CameraView }

/**
 * What the hull is doing, for the felt-motion spring. All in the SHIP's axes
 * (+X port, +Y up, +Z forward). `jolt` is consumed: the caller zeroes it after
 * handing it over.
 */
export type CameraMotion = {
  accel: THREE.Vector3;
  jolt:  THREE.Vector3;

  /** Ground speed over top speed, 0..1. */
  speed:    number;
  boosting: boolean;
}

export type CameraRigOptions = {

  /** Chase field of view, degrees. */
  chaseFov?: number;

  /** Impact shake multiplier, 0 = none. */
  shakeScale?: number;

  /** Felt-motion multiplier, 0 = a rigid boom. */
  motionScale?: number;
}

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

  /**
   * Maximum camera swing from the R/F aim axis, radians. Larger in the cockpit
   * because there the camera IS the sight — in chase the hull already shows
   * where the nose points, so the camera only needs to hint.
   */
  aimPitch: number;

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
  aimPitch:        0.16,
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
  aimPitch:        0.30,
  shakeScale:      0.35,
}

const _fwd       = new THREE.Vector3()
const _dynWorld  = new THREE.Vector3()
const _kick      = new THREE.Vector3()
const _rollQuat  = new THREE.Quaternion()
const _tiltEuler = new THREE.Euler(0, 0, 0, 'YXZ')
const _tiltQuat  = new THREE.Quaternion()
const _viewAxis  = new THREE.Vector3(0, 0, 1)
const _yawQuat   = new THREE.Quaternion()
const _blendQuat = new THREE.Quaternion()
const _hullUp    = new THREE.Vector3()
const _nextUp    = new THREE.Vector3()
const _shake     = new THREE.Vector3()
const _panEuler  = new THREE.Euler(0, 0, 0, 'YXZ')
const _panQuat   = new THREE.Quaternion()
const _leadEuler = new THREE.Euler(0, 0, 0, 'YXZ')
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
export type CameraPan = { panX: number; panY: number; pitch?: number }

export type CameraRig = {
  camera: THREE.PerspectiveCamera;

  /**
   * The HUD's anchor orientation: the ship-following station plus `HUD_LEAD` of
   * the look-around swing. Not the camera's own orientation — the visor leads
   * the look rather than tracking it, so the sightline stays clear.
   */
  hudQuaternion(target: THREE.Quaternion): THREE.Quaternion;

  /**
   * The look-around lead on its own, as a delta rotation.
   *
   * `hudQuaternion` is the cockpit anchor: the camera station with this already
   * applied. The chase anchor is framed on the HULL instead, and still wants the
   * same lead — so the delta is published rather than recomputed, and the two
   * anchors cannot disagree about how far a look-around swings.
   */
  hudLead(target: THREE.Quaternion): THREE.Quaternion;

  /** Advance the rig. Call from the RENDER phase with the real delta and the interpolated pose. */
  drive(realDelta: number, position: THREE.Vector3, quaternion: THREE.Quaternion, pan: CameraPan, motion?: CameraMotion): void;

  /** Player settings: chase FOV, shake and felt-motion strength. */
  configure(options: CameraRigOptions): void;

  /** Cut to the target immediately — spawn, respawn, teleport. */
  requestSnap(): void;

  /** Kick a decaying impact shake. */
  shake(amount: number): void;

  toggleView(): void;
  view(): CameraView;

  /**
   * Drive the chase <-> cockpit blend directly, 0 = chase, 1 = seated.
   *
   * The two views were always a lerp over one station record rather than a
   * branch, so any value between them is a real camera. `immediate` skips the
   * `TRANSITION_S` ramp, which is what lets a pinch track the fingers instead
   * of chasing them 0.55 s behind.
   */
  setBlend(value: number, immediate?: boolean): void;

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
  let aim  = 0

  /** Last applied shake + felt-motion offset, subtracted before the next update so it never feeds back. */
  const lastShake     = new THREE.Vector3()

  // The felt-motion spring: an offset in the ship's frame and its velocity,
  //  plus a roll and a FOV delta on springs of their own.
  const dynOffset   = new THREE.Vector3()
  const dynVelocity = new THREE.Vector3()
  let roll         = 0
  let rollVelocity = 0
  let fovKick      = 0
  let fovVelocity  = 0

  let chaseFov    = CHASE.fov
  let shakeScale  = 1
  let motionScale = 1
  const hudQuaternion = new THREE.Quaternion()
  const hudLead       = new THREE.Quaternion()
  let shakeAmount = 0

  /**
   * Advance the felt-motion springs by one rendered frame.
   *
   * Semi-implicit Euler in fixed sub-steps: the render delta is variable and
   * an under-damped spring stepped at 30 ms goes unstable long before one
   * stepped at 8 ms does.
   */
  function stepMotion (dt: number, motion: CameraMotion | undefined, seated: number): void {
    const scale = motionScale * (reducedMotion() ? 0.3 : 1)

    let tx         = 0
    let ty         = 0
    let tz         = 0
    let targetRoll = 0
    let targetFov  = 0

    if (motion) {
      const a = motion.accel
      tx = THREE.MathUtils.clamp(-a.x * MOTION.latGain, -MOTION.latMax, MOTION.latMax) * scale
      ty = THREE.MathUtils.clamp(-a.y * MOTION.vertGain, -MOTION.vertMax, MOTION.vertMax) * scale
      tz = THREE.MathUtils.clamp(-a.z * MOTION.longGain, -MOTION.longBack, MOTION.longForward) * scale

      // A corner to starboard is lateral load toward -X; banking the view
      // into it is a negative roll about the camera's own view axis.
      targetRoll = THREE.MathUtils.clamp(a.x * MOTION.rollGain, -MOTION.rollMax, MOTION.rollMax) * scale
      targetFov  = Math.min(MOTION.fovMax, (
        motion.speed * MOTION.fovSpeed +
        (motion.boosting ? MOTION.fovBoost : 0) +
        THREE.MathUtils.clamp(a.z * MOTION.fovAccel, -2, 4)
      ) * Math.min(1, scale)) * (1 - seated * 0.5)

      // A collision is an impulse, not a target: it throws the spring away
      // from the hit and lets it ring back.
      const jolt = motion.jolt
      if (jolt.lengthSq() > 0) {
        const magnitude = jolt.length()
        _kick.copy(jolt).multiplyScalar(-MOTION.kickGain * scale)
        if (_kick.length() > MOTION.kickMax)
          _kick.setLength(MOTION.kickMax)
        dynVelocity.add(_kick)
        if (!reducedMotion())
          shakeAmount = Math.max(shakeAmount, Math.min(1.2, magnitude * MOTION.joltShake) * shakeScale)
      }
    }

    const k     = MOTION.omega * MOTION.omega
    const c     = 2 * MOTION.zeta * MOTION.omega
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)))
    const h     = dt / steps
    for (let i = 0; i < steps; i++) {
      dynVelocity.x += (k * (tx - dynOffset.x) - c * dynVelocity.x) * h
      dynVelocity.y += (k * (ty - dynOffset.y) - c * dynVelocity.y) * h
      dynVelocity.z += (k * (tz - dynOffset.z) - c * dynVelocity.z) * h
      dynOffset.addScaledVector(dynVelocity, h)

      rollVelocity += (k * (targetRoll - roll) - c * rollVelocity) * h
      roll         += rollVelocity * h

      // The FOV spring is stiffer and critically damped: an overshooting lens
      // reads as a zoom wobble rather than as weight.
      fovVelocity += (40 * (targetFov - fovKick) - 2 * Math.sqrt(40) * fovVelocity) * h
      fovKick     += fovVelocity * h
    }

    // Keep a runaway (a solver blow-up, a teleport the caller forgot to snap)
    // from flinging the camera off into the scenery.
    if (dynOffset.lengthSq() > 9)
      dynOffset.setLength(3)
  }

  return {
    camera: rig.camera,

    hudQuaternion (target) {
      return target.copy(hudQuaternion)
    },

    hudLead (target) {
      return target.copy(hudLead)
    },

    requestSnap () {
      snapRequested = true
      shakeAmount = 0
    },

    shake (amount) {
      if (reducedMotion())
        return
      shakeAmount = Math.max(shakeAmount, amount * shakeScale)
    },

    configure (options) {
      if (options.chaseFov !== undefined && Number.isFinite(options.chaseFov))
        chaseFov = options.chaseFov
      if (options.shakeScale !== undefined)
        shakeScale = Math.max(0, options.shakeScale)
      if (options.motionScale !== undefined)
        motionScale = Math.max(0, options.motionScale)
    },

    toggleView () {
      target = target > 0.5 ? 0 : 1
    },

    setBlend (value, immediate = false) {
      target = Math.max(0, Math.min(1, value))
      if (immediate)
        raw = target
    },

    view () {
      return target > 0.5 ? 'cockpit' : 'chase'
    },

    blend () {
      return smoothstep(raw)
    },

    drive (realDelta, position, quaternion, pan, motion) {
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

      // --- felt motion ------------------------------------------------------
      // Integrated before the FOV is set, so the kick lands on this frame.
      stepMotion(realDelta, motion, e)

      const fov = lerp(chaseFov, COCKPIT.fov, e) + fovKick
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
        dynOffset.set(0, 0, 0)
        dynVelocity.set(0, 0, 0)
        roll         = 0
        rollVelocity = 0
      }
      else
        rig.update(position, _blendQuat, realDelta)

      const stationShake = lerp(CHASE.shakeScale, COCKPIT.shakeScale, e)
      let tilt           = 0

      if (shakeAmount > 0.001) {
        const magnitude = shakeAmount * stationShake
        _shake.set(
          (shakeRng.next() - 0.5) * magnitude * 2,
          (shakeRng.next() - 0.5) * magnitude * 2,
          (shakeRng.next() - 0.5) * magnitude * 2
        )
        tilt = magnitude
        shakeAmount *= Math.exp(-realDelta * 6)
      }
      else {
        _shake.set(0, 0, 0)
        shakeAmount = 0
      }

      // The spring's offset, taken from the ship's frame (yaw-only in chase,
      // the whole hull seated) into the world. Seated it is scaled right down:
      // a head in a seat moves centimetres, not the metre a boom can.
      const seat = lerp(1, MOTION.seatScale, e)
      _dynWorld.copy(dynOffset).multiplyScalar(seat)
        .applyQuaternion(_blendQuat)
      _shake.add(_dynWorld)

      rig.camera.position.add(_shake)
      lastShake.copy(_shake)

      // Roll into the corner, about the view axis, before the HUD anchor is
      // read — so the visor stays square to the frame instead of counter-
      // rotating against it.
      if (Math.abs(roll) > 1e-5) {
        _rollQuat.setFromAxisAngle(_viewAxis, roll)
        rig.camera.quaternion.multiply(_rollQuat)
      }
      if (tilt > 0) {
        _tiltEuler.set(
          (shakeRng.next() - 0.5) * 2 * tilt * SHAKE_TILT,
          (shakeRng.next() - 0.5) * 2 * tilt * SHAKE_TILT,
          0
        )
        _tiltQuat.setFromEuler(_tiltEuler)
        rig.camera.quaternion.multiply(_tiltQuat)
      }

      // Save the ship-following orientation before pointer-look. The camera is
      // free to pan across the cockpit after this, while the visor stays bolted
      // to the same station as the hull.
      hudQuaternion.copy(rig.camera.quaternion)

      // --- look-around pan --------------------------------------------------
      // Rotation only, and applied AFTER the solve. A positional pan would be
      // read back by `camera.position.lerp` on the next frame and walk the whole
      // rig off its offset — the same feedback the shake works around above.
      const k = 1 - Math.pow(2, -realDelta / PAN_HALF_LIFE)
      panX += (pan.panX - panX) * k
      panY += (pan.panY - panY) * k
      // Eased here rather than by the caller so the aim swing decays on the same
      // curve as the pointer pan — two half-lives on one euler read as a jerk.
      aim += ((pan.pitch ?? 0) - aim) * k

      const panYaw   = lerp(CHASE.panYaw, COCKPIT.panYaw, e)
      const panPitch = lerp(CHASE.panPitch, COCKPIT.panPitch, e)
      const aimSwing = lerp(CHASE.aimPitch, COCKPIT.aimPitch, e)

      // +Y is a left turn, so a rightward pointer yaws negative. A positive
      // rotation about the camera's own X tips its -Z view axis upward, which is
      // why the aim term adds where the pointer term subtracts.
      _panEuler.set(-panY * panPitch + aim * aimSwing, -panX * panYaw, 0)
      _panQuat.setFromEuler(_panEuler)
      rig.camera.quaternion.multiply(_panQuat)

      // The visor's share of the same swing, from the same eased inputs and the
      // same blended limits. Scaling the euler rather than slerping toward the
      // camera keeps one source of truth: if the two ever disagreed about how
      // far a look-around goes, the HUD would drift off the sightline.
      _leadEuler.set(_panEuler.x * HUD_LEAD, _panEuler.y * HUD_LEAD, 0)
      hudLead.setFromEuler(_leadEuler)
      hudQuaternion.multiply(hudLead)
    },
  }
}

// perf: allocation-free per frame — all scratch is hoisted, the station handed to
// `aim` is mutated in place, and the shake uses a forked seeded rng rather than
// Math.random so a replay reproduces exactly.
