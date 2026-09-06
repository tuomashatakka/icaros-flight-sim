/**
 * The plan view's camera, and the arithmetic that turns a pointer into metres.
 *
 * Top-down XZ: +x right, +z down, world units throughout. Pure functions on a
 * three-number camera, so the viewport can be reasoned about (and tested)
 * without a DOM.
 *
 * The previous editor projected onto a fixed isometric grid with hard-coded
 * screen origins, which is why it could not pan, could not zoom past the "72%"
 * printed in its corner, and clamped every coordinate into a 12×12 box.
 */

/** Logical viewport, in SVG user units. CSS scales the element; this stays fixed. */
export const VIEW_WIDTH = 1200
export const VIEW_HEIGHT = 720

export type Camera = {

  /** World point at the centre of the view. */
  x: number;
  z: number;

  /** SVG user units per world metre. */
  scale: number;
}

export const MIN_SCALE = 0.25
export const MAX_SCALE = 12

export const INITIAL_CAMERA: Camera = { x: 0, z: 0, scale: 1.4 }

export const clampScale = (scale: number): number =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

/** The SVG `viewBox` for a camera, in world units. */
export function viewBox (camera: Camera): string {
  const w = VIEW_WIDTH / camera.scale
  const h = VIEW_HEIGHT / camera.scale
  return `${camera.x - w / 2} ${camera.z - h / 2} ${w} ${h}`
}

/** Client pixel → world metres, given the element's on-screen rect. */
type RectType = { left: number; top: number; width: number; height: number }

type ToWorldReturnType = { x: number; z: number }

export function toWorld (
  camera: Camera,
  rect: RectType,
  clientX: number,
  clientY: number
): ToWorldReturnType {
  const w = VIEW_WIDTH / camera.scale
  const h = VIEW_HEIGHT / camera.scale
  return {
    x: camera.x - w / 2 + (clientX - rect.left) / Math.max(rect.width, 1) * w,
    z: camera.z - h / 2 + (clientY - rect.top) / Math.max(rect.height, 1) * h,
  }
}

/**
 * Zoom about a fixed world point, so the metre under the cursor stays under it.
 *
 * Zooming about the view centre instead is the thing that makes an editor feel
 * like it is fighting you: the feature you were pointing at slides away exactly
 * when you lean in to look at it.
 */
type AnchorType = { x: number; z: number }

export function zoomAbout (camera: Camera, anchor: AnchorType, factor: number): Camera {
  const scale = clampScale(camera.scale * factor)
  const ratio = camera.scale / scale
  return {
    scale,
    x: anchor.x + (camera.x - anchor.x) * ratio,
    z: anchor.z + (camera.z - anchor.z) * ratio,
  }
}

/** Frame a set of points with a margin, picking the scale that fits both axes. */
export function frame (points: { x: number; z: number }[], margin = 1.25): Camera {
  if (!points.length)
    return INITIAL_CAMERA

  const xs   = points.map(p => p.x)
  const zs   = points.map(p => p.z)
  const minX = Math.min(...xs),
    maxX     = Math.max(...xs)
  const minZ = Math.min(...zs),
    maxZ     = Math.max(...zs)

  const width  = Math.max(maxX - minX, 1) * margin
  const height = Math.max(maxZ - minZ, 1) * margin

  return {
    x:     (minX + maxX) / 2,
    z:     (minZ + maxZ) / 2,
    scale: clampScale(Math.min(VIEW_WIDTH / width, VIEW_HEIGHT / height)),
  }
}

/**
 * Grid pitch that keeps roughly one line every 60 screen units at any zoom.
 *
 * A fixed pitch is either a solid wall of lines when you zoom out or a blank
 * field when you zoom in; stepping through 1/5/10/25 metres keeps the deck
 * readable across the whole 0.25×–12× range.
 */
export function gridPitch (scale: number): number {
  const target = 60 / scale
  const steps  = [ 1, 5, 10, 25, 50, 100, 250, 500 ]
  return steps.find(step => step >= target) ?? 1000
}

/** Snap to the visible grid. Holding a modifier is what turns this off, in the caller. */
export const snapTo = (value: number, pitch: number): number => Math.round(value / pitch) * pitch
