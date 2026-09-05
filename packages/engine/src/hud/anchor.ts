import * as THREE from 'three'
import { HUD_REFERENCE_FOV } from './tokens'


/**
 * Where the visor sits, as one continuous function of the camera blend.
 *
 * Seated, the visor is a helmet display: bolted to the eye, filling the field of
 * view, FOV-compensated so it never changes apparent size. In chase it is a
 * hologram the ship carries: framed on the HULL's yaw, so the panels orbit the
 * hull in world space and the camera falls back from them rather than wearing
 * them. Both are the same seven facets — only the anchor, the framing and the
 * scale differ, so the pinch blend cross-fades the anchor along with everything
 * else and there is no mode flip anywhere.
 *
 * Pure and allocation-free: it writes into caller-owned scratch. The scene shell
 * supplies the poses; this decides nothing about the camera or the ship.
 */

/** Halo centre height above the hull, world units — roughly canopy level. */
const HALO_LIFT = 0.9

/**
 * World size of the halo relative to the authored visor.
 *
 * The visor's outer half-height is 2.72 units. From the chase station the panels
 * sit ~14 units from the eye at a 40 deg FOV, which gives a half-height of ~5.2
 * on screen — so at 1.0 the halo would read as a small placard hanging off the
 * nose. This frames the hull with margin without crowding the sightline.
 */
const HALO_SCALE = 1.35

const _fwd      = new THREE.Vector3()
const _chase    = new THREE.Quaternion()
const _shipPose = new THREE.Vector3()
const WORLD_UP  = new THREE.Vector3(0, 1, 0)

/**
 * The slice of a `HudFrame` this needs. Structural rather than importing the
 * frame type, so the function stays testable from a plain object literal.
 */
export type HudStationInput = {

  /** 0 = fully chase, 1 = fully seated. `CameraRig.blend()`. */
  cameraBlend: number;
  camera:      THREE.Camera;

  /** Cockpit anchor orientation: the camera station with the look-around lead applied. */
  hudQuaternion: THREE.Quaternion;

  /** The look-around lead alone, so the hull-framed anchor can carry the same swing. */
  hudLead: THREE.Quaternion;

  shipPosition:   THREE.Vector3;
  hullQuaternion: THREE.Quaternion;
}

export type HudStation = {
  position:   THREE.Vector3;
  quaternion: THREE.Quaternion;

  /** x/y only — the visor's authored depth fold is never scaled. */
  scale: THREE.Vector2;
}

export function createHudStation (): HudStation {
  return {
    position:   new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale:      new THREE.Vector2(1, 1),
  }
}

export function hudStation (out: HudStation, input: HudStationInput): HudStation {
  const { cameraBlend, camera, hudQuaternion, hudLead, shipPosition, hullQuaternion } = input

  const perspective = camera instanceof THREE.PerspectiveCamera ? camera : null
  const fov         = perspective?.fov ?? HUD_REFERENCE_FOV
  const aspect      = perspective?.aspect ?? 16 / 9

  // Keeps the seated visor the same angular size through the FOV lerp; the
  // reference FOV is the one its bounds were authored against.
  const fovScale = Math.tan(THREE.MathUtils.degToRad(fov * 0.5)) /
    Math.tan(THREE.MathUtils.degToRad(HUD_REFERENCE_FOV * 0.5))

  // Portrait would otherwise push the outer facets past the frame edge. Applied
  // at both ends: legibility is not a property of which view you are in.
  const squeeze = Math.min(1, aspect / (16 / 9))

  // The visor looks down its own -Z, and the ship's forward is +Z, so the
  // hull-framed anchor is the hull's yaw turned to face back down the nose —
  // the same orientation the chase camera holds, minus its follow damping. That
  // missing damping is the point: the halo stays square to the HULL, so a hard
  // turn visibly swings it around the ship instead of dragging it along.
  _fwd.set(0, 0, 1).applyQuaternion(hullQuaternion)
  _chase.setFromAxisAngle(WORLD_UP, Math.atan2(_fwd.x, _fwd.z) + Math.PI)
    .multiply(hudLead)

  _shipPose.copy(shipPosition).addScaledVector(WORLD_UP, HALO_LIFT)

  const scale = THREE.MathUtils.lerp(HALO_SCALE, fovScale, cameraBlend)

  out.position.lerpVectors(_shipPose, camera.position, cameraBlend)
  out.quaternion.slerpQuaternions(_chase, hudQuaternion, cameraBlend)
  out.scale.set(scale * squeeze, scale)

  return out
}
