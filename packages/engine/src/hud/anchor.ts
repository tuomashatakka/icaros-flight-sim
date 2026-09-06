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

/** The aspect the visor's bounds were authored against. */
const REFERENCE_ASPECT = 16 / 9

/** `HUD_VISOR_BOUNDS.outerX` / `outerY`: the authored visor's outer half-extents. */
const VISOR_HALF_WIDTH  = 4.35
const VISOR_HALF_HEIGHT = 2.72

/**
 * The frame's half-height, in the units the visor is authored in.
 *
 * At the reference aspect the seated visor spans the frame's full width, so the
 * frame's half-width IS `VISOR_HALF_WIDTH`; its half-height follows from the
 * aspect. Everything about portrait placement is measured against this.
 */
const FRAME_HALF_HEIGHT = VISOR_HALF_WIDTH / REFERENCE_ASPECT

/**
 * The bottom band of the frame the visor keeps clear, as a fraction of the
 * frame's half-height — so 0.66 is the bottom third of the screen.
 *
 * The thumb cluster lives there — two sticks, two shoulder rails and the
 * utility pair — and it is drawn on the screen layer, in FRONT of the visor.
 * Instruments behind a stick are instruments you cannot read, and in portrait
 * there is plenty of frame to move them out of.
 */
const THUMB_BAND = 0.66

/**
 * The aspect below which the visor is WORN rather than carried.
 *
 * The chase station hangs the panels around the hull, ten-odd units down the
 * nose, which is a good hologram on a monitor and an unreadable speck on a
 * phone held upright: fitting it to a 390 px frame leaves each outer facet
 * about 85 px wide. The seated station is screen-locked and fills the frame's
 * full width by construction, which is three times the size for the same
 * pixels — so as the frame narrows the station slides to the seated one
 * regardless of where the CAMERA is. The camera does not move; only the
 * anchor does, and a third-person view with a helmet HUD over it is what a
 * phone wants anyway.
 */
const WORN_ASPECT = 1.2

/** Aspect at which the slide to the worn station is complete. */
const WORN_ASPECT_FULL = 0.8

const _fwd      = new THREE.Vector3()
const _chase    = new THREE.Quaternion()
const _shipPose = new THREE.Vector3()
const _up       = new THREE.Vector3()
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

  // Portrait would otherwise push the outer facets past the frame edge, so the
  // visor is scaled to fit the frame's width — UNIFORMLY, on both axes.
  //
  // It used to scale X alone. That does keep the outer facets on screen, and it
  // does it by squashing the visor to 26 % of its width on a 19.5:9 phone while
  // leaving its height untouched: every readout became a letterbox of
  // half-width glyphs, and the seven facets stopped reading as one curved
  // surface because the fold they are drawn on was no longer the fold they were
  // authored on. Fitting proportionally costs size and keeps the shape, which
  // is the trade that leaves it legible.
  const fit = Math.min(1, aspect / REFERENCE_ASPECT)

  // Where the visor sits in the frame, in frame-half-heights below centre.
  //
  // A cockpit puts its instruments UNDER the sightline; the middle of the
  // canopy is the part you look through. In landscape the visor already fills
  // the frame and this is zero, so nothing moves. Portrait leaves two thirds of
  // the frame spare, and floating the cluster dead centre spends that on
  // nothing — it hangs the panels across the horizon and still collides with
  // the thumb controls at the bottom. Dropping it to sit just above the thumb
  // band opens the sightline and closes the collision with the same number.
  const drop = Math.min(0, VISOR_HALF_HEIGHT * fit / FRAME_HALF_HEIGHT - (1 - THUMB_BAND))

  // The visor looks down its own -Z, and the ship's forward is +Z, so the
  // hull-framed anchor is the hull's yaw turned to face back down the nose —
  // the same orientation the chase camera holds, minus its follow damping. That
  // missing damping is the point: the halo stays square to the HULL, so a hard
  // turn visibly swings it around the ship instead of dragging it along.
  _fwd.set(0, 0, 1).applyQuaternion(hullQuaternion)
  _chase.setFromAxisAngle(WORLD_UP, Math.atan2(_fwd.x, _fwd.z) + Math.PI)
    .multiply(hudLead)

  _shipPose.copy(shipPosition).addScaledVector(WORLD_UP, HALO_LIFT)

  // How SEATED the visor is, which is the camera's blend everywhere the frame is
  // wide enough to carry a halo and is driven to 1 by the frame itself where it
  // is not. One number, still continuous, so the pinch keeps working and there
  // is no orientation flip anywhere.
  const worn    = THREE.MathUtils.clamp((WORN_ASPECT - aspect) / (WORN_ASPECT - WORN_ASPECT_FULL), 0, 1)
  const framing = cameraBlend + (1 - cameraBlend) * worn

  const scale = THREE.MathUtils.lerp(HALO_SCALE, fovScale, framing)

  out.position.lerpVectors(_shipPose, camera.position, framing)
  out.quaternion.slerpQuaternions(_chase, hudQuaternion, framing)
  out.scale.set(scale * fit, scale * fit)

  // Along the station's OWN up, not the world's, so the dash stays under the
  // sightline through a roll instead of sliding across the canopy.
  if (drop < 0) {
    _up.set(0, 1, 0).applyQuaternion(out.quaternion)
    out.position.addScaledVector(_up, drop * FRAME_HALF_HEIGHT * fovScale)
  }

  return out
}
