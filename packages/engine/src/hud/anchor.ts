import * as THREE from 'three'
import { HUD_REFERENCE_FOV } from './tokens'


/**
 * Where the visor sits.
 *
 * On the EYE, always. The visor is a helmet display: bolted to the camera,
 * filling the field of view, FOV-compensated so it never changes apparent size
 * however the camera lerps. It does not know where the ship is, and the pinch
 * blend moves the camera without moving it.
 *
 * It used to be two stations cross-faded by that blend — seated on the camera,
 * and in chase a hologram framed on the HULL's yaw so the panels orbited the
 * ship. The halo read well in a screenshot and badly in play: chase is the
 * default view, the hull sits nine units off the eye, and a visor authored at
 * arm's length rendered at that distance is a placard on the horizon. Every
 * readout on it was too small to read, which is the only job it has.
 *
 * Pure and allocation-free: it writes into caller-owned scratch. The scene shell
 * supplies the poses; this decides nothing about the camera or the ship.
 */

/** The aspect the visor's bounds were authored against. */
const REFERENCE_ASPECT = 16 / 9

/** `HUD_VISOR_BOUNDS.outerX` / `outerY`: the authored visor's outer half-extents. */
const VISOR_HALF_WIDTH  = 4.35
const VISOR_HALF_HEIGHT = 2.72

/**
 * The frame's half-height, in the units the visor is authored in.
 *
 * The visor spans the frame's full width, so the frame's half-width IS
 * `VISOR_HALF_WIDTH`; its half-height follows from the aspect. Everything about
 * vertical placement is measured against this.
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

const _up = new THREE.Vector3()

/**
 * The slice of a `HudFrame` this needs. Structural rather than importing the
 * frame type, so the function stays testable from a plain object literal.
 */
export type HudStationInput = {

  /**
   * 0 = fully chase, 1 = fully seated. `CameraRig.blend()`.
   *
   * The visor no longer moves with it — it is on the eye at either end — but the
   * shell still reports it and the HUD's own painters read it, so it stays on
   * the input rather than being removed from a shared record.
   */
  cameraBlend: number;
  camera:      THREE.Camera;

  /** Cockpit anchor orientation: the camera station with the look-around lead applied. */
  hudQuaternion: THREE.Quaternion;

  /** The look-around lead alone. Retained for callers that frame off it. */
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
  const { camera, hudQuaternion } = input

  const perspective = camera instanceof THREE.PerspectiveCamera ? camera : null
  const fov         = perspective?.fov ?? HUD_REFERENCE_FOV
  const aspect      = perspective?.aspect ?? REFERENCE_ASPECT

  // Keeps the visor the same angular size through the FOV lerp; the reference
  // FOV is the one its bounds were authored against.
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

  out.position.copy(camera.position)
  out.quaternion.copy(hudQuaternion)
  out.scale.set(fovScale * fit, fovScale * fit)

  // Along the station's OWN up, not the world's, so the dash stays under the
  // sightline through a roll instead of sliding across the canopy.
  if (drop < 0) {
    _up.set(0, 1, 0).applyQuaternion(out.quaternion)
    out.position.addScaledVector(_up, drop * FRAME_HALF_HEIGHT * fovScale)
  }

  return out
}
