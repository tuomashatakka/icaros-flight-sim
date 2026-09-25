import * as THREE from 'three'
import type { Controls } from '../input'
import { drawHoloPlate, drawPlateLabel, glowStroke } from './chrome'
import { createHudFacetMaterial } from './materials'
import type { HudFacetMaterial } from './materials'
import { HudPanel } from './panel'
import { HUD_HUES as HUES } from './tokens'
import { touchLayout } from './touch-layout'
import type { SafeAreaInsets, TouchLayout } from './touch-layout'
import type { HudActionId, HudMode } from './types'


/**
 * The thumb controls, as part of the visor rather than stuck over it.
 *
 * They used to be flat plates painted on the full-screen overlay: a different
 * material from the visor, drawn over its lower facets, and re-rasterised with
 * the rest of that 1280x720 sheet at up to 30 Hz whether a thumb was on them or
 * not. Now they are a hologram of their own, shaded by the SAME facet shader
 * the visor's panels use — the chromatic fringe, the scanlines, the glow, the
 * scan-in wipe — on a surface that curves toward the eye at the edges the way
 * the visor's wings do, while the visor itself folds inward to leave them the
 * outer ring of the frame (`hudStation`'s `touchDeck`).
 *
 * The curve does not cost the hit test anything. Every vertex sits on the SAME
 * view ray it would on a flat screen plane — only its depth changes — so a
 * canvas pixel still lands on exactly the screen pixel it always did, and the
 * regions stay in plain canvas coordinates, just as the overlay's are.
 *
 * The two knobs are separate quads moved every frame. A stick is the one
 * control that changes at thumb rate, and redrawing and re-uploading a
 * full-frame raster to move a 60 px disc was the single most expensive thing
 * the HUD did while you were actually using it.
 */

const TAU = Math.PI * 2

/** Deck depth at the centre of the frame, and how much nearer the edges fold. */
const DECK_DEPTH  = 4.2
const DECK_CURL_X = 0.95
const DECK_CURL_Y = 0.3

const GRID_X = 24
const GRID_Y = 14

/** Where the knobs float, in front of the surface they ride on. */
const KNOB_LIFT = 0.04

/** Knob raster, square. */
const KNOB_PX = 128

/**
 * Surface depth for a point in normalised device coordinates.
 *
 * A shallow bowl: nearest at the side edges, where the sticks and the rails
 * are, like the inside of a helmet visor.
 */
export function deckDepth (ndcX: number, ndcY: number): number {
  return DECK_DEPTH - DECK_CURL_X * ndcX * ndcX - DECK_CURL_Y * ndcY * ndcY
}

/**
 * The bowl, in RAY units: a vertex at `ndc` sits at `(ndcX * d, ndcY * d, -d)`.
 *
 * The group it hangs from is scaled by `(tan(fov/2) * aspect, tan(fov/2), 1)`
 * every frame, which puts each vertex back on its true view ray for whatever
 * lens the camera has this frame — the FOV kicks with boost now, so this is
 * not a one-off.
 */
function createDeckGeometry (): THREE.BufferGeometry {
  const positions: number[] = []
  const uvs: number[]       = []
  const indices: number[]   = []

  for (let row = 0; row <= GRID_Y; row++) {
    const v    = row / GRID_Y
    const ndcY = v * 2 - 1
    for (let column = 0; column <= GRID_X; column++) {
      const u    = column / GRID_X
      const ndcX = u * 2 - 1
      const d    = deckDepth(ndcX, ndcY)
      positions.push(ndcX * d, ndcY * d, -d)
      uvs.push(u, v)
    }
  }

  const stride = GRID_X + 1
  for (let row = 0; row < GRID_Y; row++)
    for (let column = 0; column < GRID_X; column++) {
      const a = row * stride + column
      const b = a + 1
      const c = a + stride
      const d = c + 1
      indices.push(a, b, c, c, b, d)
    }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** A glowing chamfered knob, drawn once. */
function createKnobTexture (accent: string): THREE.CanvasTexture {
  const canvas  = document.createElement('canvas')
  canvas.width  = KNOB_PX
  canvas.height = KNOB_PX

  const context = canvas.getContext('2d')
  if (context) {
    const half = KNOB_PX * 0.5
    const glow = context.createRadialGradient(half, half, 0, half, half, half)
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.35)')
    glow.addColorStop(0.55, 'rgba(120, 220, 255, 0.12)')
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
    context.fillStyle = glow
    context.fillRect(0, 0, KNOB_PX, KNOB_PX)
    drawHoloPlate(context, { x: half * 0.42, y: half * 0.42, width: half * 1.16, height: half * 1.16 }, { accent, active: true, chamfer: 0.34 })
    glowStroke(context, ctx => ctx.arc(half, half, half * 0.14, 0, TAU), accent, 2, 0.9)
  }

  const texture           = new THREE.CanvasTexture(canvas)
  texture.colorSpace      = THREE.SRGBColorSpace
  texture.minFilter       = THREE.LinearFilter
  texture.generateMipmaps = false
  return texture
}

/**
 * A touch control's accent, by name.
 *
 * Named hues rather than roles: the rail is a physical layout and the colour is
 * how a thumb tells two adjacent plates apart without reading either label.
 */
const ACCENTS = {
  cyan:    HUES.cyan,
  magenta: HUES.magenta,
  amber:   HUES.amber,
  violet:  HUES.violet,
  green:   HUES.green,
} as const

/**
 * Whether a hold action is engaged right now.
 *
 * Read off `Controls` where it exists there, so a key and a thumb light the
 * same plate. The lateral and brake axes are shared with the sticks, so those
 * fall back to the pressed set rather than claiming a stick's deflection.
 */
function liveHold (action: HudActionId, controls: Controls): boolean {
  switch (action) {
    case 'boost':
      return controls.boost
    case 'fire-primary':
      return controls.fire
    case 'fire-secondary':
      return controls.fireSecondary
    default:
      return false
  }
}

export type TouchDeckFrame = {
  camera:   THREE.Camera;
  aspect:   number;
  elapsed:  number;
  mode:     HudMode;
  insets:   SafeAreaInsets;
  cssSize:  { width: number; height: number };
  controls: Controls;
  held:     ReadonlySet<HudActionId>;
  stickX:   Record<'move' | 'aim', number>;
  stickY:   Record<'move' | 'aim', number>;

  /** Arrival, 0..1 — drives the facet shader's own scan-in. */
  phase: number;
}

export type TouchDeck = {
  object: THREE.Group;
  panel:  HudPanel;

  /** Reposition, re-lens and — only when something it shows changed — redraw. */
  update(frame: TouchDeckFrame): void;

  /** Force the next update to redraw. */
  invalidate(): void;

  /** The layout the regions were last drawn from, for stick travel. */
  layout(): TouchLayout | null;
  dispose(): void;
}

type Knob = {
  mesh:     THREE.Mesh;
  material: HudFacetMaterial;
  texture:  THREE.CanvasTexture;
}

export function createTouchDeck (): TouchDeck {
  const panel    = new HudPanel({ name: 'touch-deck', width: 1280, height: 720, center: true })
  const geometry = createDeckGeometry()
  const material = createHudFacetMaterial({ map: panel.texture, accent: HUES.cyan, opacity: 1 })
  const mesh     = new THREE.Mesh(geometry, material)
  mesh.name      = 'spatial-cockpit-hud-touch-deck'
  // Over the visor's facets (1000) and under the sight (1002).
  mesh.renderOrder   = 1001
  mesh.frustumCulled = false
  mesh.raycast       = () => {}

  const lens = new THREE.Group()
  lens.add(mesh)

  const object = new THREE.Group()
  object.name  = 'spatial-cockpit-hud-touch'
  object.add(lens)

  const quad  = new THREE.PlaneGeometry(1, 1)
  const knobs = {} as Record<'move' | 'aim', Knob>
  for (const stick of [ 'move', 'aim' ] as const) {
    const texture      = createKnobTexture(HUES.cyan)
    const knobMaterial = createHudFacetMaterial({ map: texture, accent: HUES.cyan, opacity: 1 })
    const knob         = new THREE.Mesh(quad, knobMaterial)
    knob.renderOrder   = 1002
    knob.frustumCulled = false
    knob.raycast       = () => {}
    knob.visible       = false
    lens.add(knob)
    knobs[stick] = { mesh: knob, material: knobMaterial, texture }
  }

  let dirty                          = true
  let lastLayout: TouchLayout | null = null
  let lastHoldMask                   = -1
  let lastEngaged                    = -1
  let lastHovered: string | null     = null
  let lastMode: HudMode | null       = null

  function place (
    knob: Knob,
    stick: TouchLayout['sticks'][number],
    offsetX: number,
    offsetY: number
  ): void {
    const { width, height } = panel.canvas
    const x                 = stick.centerX + offsetX * stick.radius * 0.66
    const y                 = stick.centerY + offsetY * stick.radius * 0.66
    const ndcX              = x / width * 2 - 1
    const ndcY              = 1 - y / height * 2
    const d                 = deckDepth(ndcX, ndcY) - KNOB_LIFT
    // The knob's plate fills 58 % of its raster, and the knob is 0.6 of the
    // well's radius across — the proportions the flat stick was drawn at.
    const size = stick.radius * 0.6 / 0.58

    knob.mesh.position.set(ndcX * d, ndcY * d, -d)
    // Ray units: a canvas-pixel span `s` is `2 s / W * d` across and
    // `2 s / H * d` up, and the lens scale makes the two equal on screen.
    knob.mesh.scale.set(2 * size / width * d, 2 * size / height * d, 1)
    knob.mesh.visible = true
  }

  function draw (frame: TouchDeckFrame, layout: TouchLayout): void {
    const { context, canvas } = panel
    panel.regions.length      = 0
    context.clearRect(0, 0, canvas.width, canvas.height)

    for (const stick of layout.sticks) {
      const engaged = Math.hypot(frame.stickX[stick.stick], frame.stickY[stick.stick]) > 0.02
      drawStickBase(context, stick.centerX, stick.centerY, stick.radius, engaged, stick.label)
      panel.region({
        id:     `stick:${stick.stick}`,
        kind:   'stick',
        stick:  stick.stick,
        x:      stick.centerX - stick.radius,
        y:      stick.centerY - stick.radius,
        width:  stick.radius * 2,
        height: stick.radius * 2,
      })
    }

    for (const button of layout.buttons) {
      const accent = ACCENTS[button.accent]
      const active = button.hold
        ? frame.held.has(button.action) || liveHold(button.action, frame.controls)
        : false

      drawHoloPlate(context, button.rect, { accent, active })
      drawPlateLabel(
        context,
        button.label,
        button.rect.x + button.rect.width * 0.5,
        button.rect.y + button.rect.height * 0.5,
        { size: Math.max(11, Math.min(button.rect.height * 0.26, button.rect.width * 0.19)), color: accent }
      )
      panel.region({
        id:     button.id,
        kind:   button.hold ? 'hold' : 'button',
        x:      button.rect.x,
        y:      button.rect.y,
        width:  button.rect.width,
        height: button.rect.height,
        action: button.action,
      })
    }

    panel.texture.needsUpdate = true
  }

  return {
    object,
    panel,

    update (frame) {
      const camera = frame.camera
      const fov    = camera instanceof THREE.PerspectiveCamera ? camera.fov : 60
      const tan    = Math.tan(THREE.MathUtils.degToRad(fov * 0.5))

      // Camera-locked every frame: pose, then the lens that maps the bowl's
      // rays onto this frame's frustum.
      object.position.copy(camera.position)
      object.quaternion.copy(camera.quaternion)
      lens.scale.set(tan * frame.aspect, tan, 1)
      object.updateMatrixWorld(true)

      material.uniforms.uTime.value   = frame.elapsed
      material.uniforms.uReveal.value = frame.phase
      for (const stick of [ 'move', 'aim' ] as const) {
        knobs[stick].material.uniforms.uTime.value   = frame.elapsed
        knobs[stick].material.uniforms.uReveal.value = frame.phase
      }

      const layout = touchLayout({
        width:     panel.canvas.width,
        height:    panel.canvas.height,
        cssWidth:  frame.cssSize.width,
        cssHeight: frame.cssSize.height,
        insets:    frame.insets,
        mode:      frame.mode,
      })

      // What the raster shows that can change without a resize: which plates
      // are lit, which sticks are held, which control the mouse is over.
      let holdMask = 0
      layout.buttons.forEach((button, index) => {
        if (button.hold && (frame.held.has(button.action) || liveHold(button.action, frame.controls)))
          holdMask |= 1 << index
      })

      const engaged = (Math.hypot(frame.stickX.move, frame.stickY.move) > 0.02 ? 1 : 0) |
        (Math.hypot(frame.stickX.aim, frame.stickY.aim) > 0.02 ? 2 : 0)

      if (holdMask !== lastHoldMask || engaged !== lastEngaged || panel.hovered !== lastHovered || frame.mode !== lastMode)
        dirty = true

      if (dirty) {
        draw(frame, layout)
        dirty        = false
        lastHoldMask = holdMask
        lastEngaged  = engaged
        lastHovered  = panel.hovered
        lastMode     = frame.mode
      }
      lastLayout = layout

      for (const stick of layout.sticks)
        place(knobs[stick.stick], stick, frame.stickX[stick.stick], frame.stickY[stick.stick])
    },

    invalidate () {
      dirty = true
    },

    layout: () => lastLayout,

    dispose () {
      panel.dispose()
      geometry.dispose()
      material.dispose()
      quad.dispose()
      for (const stick of [ 'move', 'aim' ] as const) {
        knobs[stick].material.dispose()
        knobs[stick].texture.dispose()
      }
      object.removeFromParent()
      object.clear()
    },
  }
}

/**
 * A stick's well, without its knob — the knob is its own quad.
 *
 * Four arcs with cardinal gaps: the gaps are where the ticks go, and the break
 * is what keeps a 200 px circle from reading as a button.
 */
function drawStickBase (
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  engaged: boolean,
  label: string
): void {
  const accent = HUES.cyan
  context.save()

  const glass = context.createRadialGradient(centerX, centerY, radius * 0.1, centerX, centerY, radius)
  glass.addColorStop(0, engaged ? 'rgba(80, 220, 255, .22)' : 'rgba(80, 220, 255, .1)')
  glass.addColorStop(0.72, 'rgba(80, 220, 255, .05)')
  glass.addColorStop(1, 'rgba(3, 10, 16, .42)')
  context.beginPath()
  context.arc(centerX, centerY, radius, 0, TAU)
  context.fillStyle = glass
  context.fill()

  context.strokeStyle = accent
  context.globalAlpha = engaged ? 0.95 : 0.55
  context.lineWidth   = 2.4
  for (let i = 0; i < 4; i++) {
    const start = 0.22 + i * Math.PI * 0.5
    context.beginPath()
    context.arc(centerX, centerY, radius, start, start + Math.PI * 0.5 - 0.44)
    context.stroke()
  }

  // The gate: where the axis starts to push.
  context.globalAlpha = 0.3
  context.lineWidth   = 1.5
  context.setLineDash([ 4, 6 ])
  context.beginPath()
  context.arc(centerX, centerY, radius * 0.66, 0, TAU)
  context.stroke()
  context.setLineDash([])

  context.globalAlpha = 0.28
  context.beginPath()
  for (const [ dx, dy ] of [[ -1, 0 ], [ 1, 0 ], [ 0, -1 ], [ 0, 1 ]] as Array<[number, number]>) {
    context.moveTo(centerX + dx * radius * 0.24, centerY + dy * radius * 0.24)
    context.lineTo(centerX + dx * radius * 0.82, centerY + dy * radius * 0.82)
  }
  context.stroke()
  context.restore()

  drawPlateLabel(context, label, centerX, centerY - radius - 13, { size: 11, alpha: 0.6, color: accent })
}
