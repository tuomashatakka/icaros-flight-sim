import * as THREE from 'three';
import { createFollowCamera, type SeededRng } from 'threejs-scene';

// Camera feel — the original framerate-independent damping RATES, in `1 - exp(-k*dt)`.
const CAM_YAW_STIFFNESS = 4;
const CAM_POS_STIFFNESS = 12;
const CAM_LOOK_STIFFNESS = 10;

/**
 * `createFollowCamera` damps with a half-life in `1 - 2^(-dt/h)`, not a rate in
 * `1 - exp(-k*dt)`. The two agree at h = ln2 / k, so the original feel is
 * preserved by converting rather than by passing the rates through.
 */
const halfLife = (rate: number) => Math.LN2 / rate;

const _fwd = new THREE.Vector3();
const _yawQuat = new THREE.Quaternion();
const _shake = new THREE.Vector3();
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export type ChaseRig = {
  camera: THREE.PerspectiveCamera;
  /** Advance the rig. Call from the RENDER phase with the real delta and the interpolated pose. */
  drive(realDelta: number, position: THREE.Vector3, quaternion: THREE.Quaternion): void;
  /** Cut to the target immediately — spawn, respawn, teleport. */
  requestSnap(): void;
  /** Kick a decaying impact shake. */
  shake(amount: number): void;
};

/**
 * Third-person chase camera.
 *
 * Trails the ship's HEADING at a fixed distance and height. The camera stays
 * world-level: banking it with the ship is nauseating, so it follows only yaw,
 * smoothed shortest-path. That is why `createFollowCamera` is fed a yaw-only
 * quaternion instead of the hull's real orientation — the rig applies whatever
 * quaternion it is given to its offset, so the ship's bank and pitch would
 * otherwise roll the whole frame.
 */
export function createChaseRig(rng: SeededRng): ChaseRig {
  const shakeRng = rng.fork('camera-shake');

  const rig = createFollowCamera({
    offset: [0, 3.4, -9],
    lookAhead: 0.8,
    positionDamping: halfLife(CAM_POS_STIFFNESS),
    lookDamping: halfLife(CAM_LOOK_STIFFNESS),
    fov: 40,
    near: 0.1,
    far: 400,
  });

  let camYaw: number | null = null;
  let snapRequested = true;
  /** Last applied shake, subtracted before the next update so it never feeds back. */
  const lastShake = new THREE.Vector3();
  let shakeAmount = 0;

  return {
    camera: rig.camera,

    requestSnap() {
      snapRequested = true;
      shakeAmount = 0;
    },

    shake(amount) {
      shakeAmount = Math.max(shakeAmount, amount);
    },

    drive(realDelta, position, quaternion) {
      _fwd.set(0, 0, 1).applyQuaternion(quaternion);
      const shipYaw = Math.atan2(_fwd.x, _fwd.z);

      if (camYaw === null || snapRequested) camYaw = shipYaw;
      else {
        let deltaYaw = shipYaw - camYaw;
        deltaYaw = Math.atan2(Math.sin(deltaYaw), Math.cos(deltaYaw)); // wrap to [-pi, pi]
        camYaw += deltaYaw * (1 - Math.exp(-CAM_YAW_STIFFNESS * realDelta));
      }

      _yawQuat.setFromAxisAngle(WORLD_UP, camYaw);

      // The rig lerps from the camera's CURRENT position, so last frame's shake
      // would be smoothed into the settled pose and drift the whole rig. Remove
      // it, let the rig settle clean, then re-apply.
      rig.camera.position.sub(lastShake);

      if (snapRequested) {
        rig.snap(position, _yawQuat);
        snapRequested = false;
      } else {
        rig.update(position, _yawQuat, realDelta);
      }

      if (shakeAmount > 0.001) {
        _shake.set(
          (shakeRng.next() - 0.5) * shakeAmount * 2,
          (shakeRng.next() - 0.5) * shakeAmount * 2,
          (shakeRng.next() - 0.5) * shakeAmount * 2
        );
        shakeAmount *= Math.exp(-realDelta * 6);
      } else {
        _shake.set(0, 0, 0);
        shakeAmount = 0;
      }

      rig.camera.position.add(_shake);
      lastShake.copy(_shake);
    },
  };
}

// perf: allocation-free per frame — all scratch is hoisted, and the shake uses a
// forked seeded rng rather than Math.random so a replay reproduces exactly.
