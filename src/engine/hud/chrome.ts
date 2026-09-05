import { HUD_COLORS as COLORS, HUD_FONT as FONT, HUD_SURFACES as SURFACES } from './tokens'


/**
 * The HUD's drawing vocabulary, shared by the facets' overlay layer and the
 * touch controls.
 *
 * The visor is built from cut-corner plates, doubled strokes, segmented arcs
 * and a rolling scanline. The overlay was built from `fillRect` and
 * `strokeRect`, and the touch controls from plain circles — so the two halves
 * of the same HUD did not look related. Everything drawn on the screen plane
 * comes through here now.
 */

const TAU = Math.PI * 2

export type Rect = { x: number; y: number; width: number; height: number }

export type PlateStyle = {
  accent?: string;

  /** Held or engaged: the accent takes over the fill and the plate glows. */
  active?: boolean;

  /** Pointer is over it. Brightens the stroke without claiming the accent. */
  hovered?:  boolean;
  disabled?: boolean;

  /** Corner cut as a fraction of the shorter side. 0 gives square corners. */
  chamfer?: number;
  alpha?:   number;

  /** Skip the inner rule — for plates too small to carry one. */
  plain?: boolean;
}

/**
 * The cut-corner silhouette every HUD surface uses.
 *
 * Two opposite corners are chamfered rather than all four: it is the same
 * asymmetry the visor's `screen` traces have, and it reads as a machined panel
 * instead of a rounded rectangle.
 */
export function chamferPath (
  context: CanvasRenderingContext2D,
  rect: Rect,
  chamfer: number
): void {
  const { x, y, width, height } = rect
  const cut                     = Math.min(chamfer, width * 0.5, height * 0.5)

  context.beginPath()
  context.moveTo(x + cut, y)
  context.lineTo(x + width, y)
  context.lineTo(x + width, y + height - cut)
  context.lineTo(x + width - cut, y + height)
  context.lineTo(x, y + height)
  context.lineTo(x, y + cut)
  context.closePath()
}

/** Fill, stroke, inner rule and glow — one HUD surface. */
export function drawPlate (
  context: CanvasRenderingContext2D,
  rect: Rect,
  style: PlateStyle = {}
): void {
  const accent   = style.accent ?? COLORS.cyan
  const chamfer  = (style.chamfer ?? 0.22) * Math.min(rect.width, rect.height)
  const disabled = style.disabled ?? false

  context.save()
  context.globalAlpha = style.alpha ?? 1

  chamferPath(context, rect, chamfer)
  context.fillStyle = disabled
    ? 'rgba(8, 18, 28, .34)'
    : style.active
      ? `${accent}33`
      : style.hovered
        ? 'rgba(180, 225, 255, .15)'
        : SURFACES.ink
  context.fill()

  context.lineWidth   = style.hovered || style.active ? 2.5 : 1.8
  context.strokeStyle = disabled
    ? SURFACES.edgeDim
    : style.active || style.hovered
      ? accent
      : SURFACES.edge
  context.stroke()

  if (style.active) {
    context.shadowColor = accent
    context.shadowBlur  = 10
    context.stroke()
    context.shadowBlur = 0
  }

  if (!style.plain && Math.min(rect.width, rect.height) > 34) {
    const inset         = 5
    context.globalAlpha = (style.alpha ?? 1) * 0.3
    chamferPath(context, {
      x:      rect.x + inset,
      y:      rect.y + inset,
      width:  rect.width - inset * 2,
      height: rect.height - inset * 2,
    }, Math.max(0, chamfer - inset))
    context.lineWidth = 1
    context.stroke()
  }

  context.restore()
}

/**
 * A rolling scanline band, matching the facet shader's.
 *
 * Cheap on purpose: a handful of 1 px rules, not a per-pixel pattern. It is
 * what ties a canvas-drawn plate to the shader-drawn facets behind it.
 */
export function drawScanlines (
  context: CanvasRenderingContext2D,
  rect: Rect,
  elapsed: number,
  accent: string = COLORS.cyan
): void {
  const spacing = 6
  context.save()
  chamferPath(context, rect, 0)
  context.clip()
  context.globalAlpha = 0.06
  context.fillStyle   = accent
  for (let y = rect.y + elapsed * 22 % spacing; y < rect.y + rect.height; y += spacing)
    context.fillRect(rect.x, y, rect.width, 1)
  context.restore()
}

export type PlateLabelStyle = {
  color?:  string;
  size?:   number;
  weight?: number;
  alpha?:  number;
  align?:  CanvasTextAlign;
}

export function drawPlateLabel (
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  style: PlateLabelStyle = {}
): void {
  context.save()
  context.font         = `${style.weight ?? 600} ${style.size ?? 13}px ${FONT}`
  context.textAlign    = style.align ?? 'center'
  context.textBaseline = 'middle'
  context.globalAlpha  = style.alpha ?? 0.85
  context.fillStyle    = style.color ?? COLORS.white
  context.fillText(value.toUpperCase(), x, y)
  context.restore()
}

export type StickStyle = {
  accent?: string;

  /** Knob offset, -1..1 per axis. */
  offsetX: number;
  offsetY: number;

  /** Whether a finger currently owns it. */
  engaged?: boolean;
  label?:   string;
}

/**
 * A twin-stick pad in the visor's language: a segmented gate ring rather than a
 * plain circle, cardinal ticks, and a chamfered knob that glows when held.
 */
export function drawStick (
  context: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  style: StickStyle
): void {
  const accent = style.accent ?? COLORS.cyan

  context.save()

  context.fillStyle = SURFACES.ink
  context.beginPath()
  context.arc(centerX, centerY, radius, 0, TAU)
  context.fill()

  // Four arcs with cardinal gaps — the gaps are where the ticks go, and the
  // break is what keeps a 200 px circle from reading as a button.
  context.strokeStyle = accent
  context.globalAlpha = style.engaged ? 0.85 : 0.42
  context.lineWidth   = 2
  for (let i = 0; i < 4; i++) {
    const start = 0.22 + i * Math.PI * 0.5
    context.beginPath()
    context.arc(centerX, centerY, radius, start, start + Math.PI * 0.5 - 0.44)
    context.stroke()
  }

  context.globalAlpha = 0.22
  context.lineWidth   = 1.5
  context.beginPath()
  for (const [ dx, dy ] of [[ -1, 0 ], [ 1, 0 ], [ 0, -1 ], [ 0, 1 ]] as Array<[number, number]>) {
    context.moveTo(centerX + dx * radius * 0.24, centerY + dy * radius * 0.24)
    context.lineTo(centerX + dx * radius * 0.82, centerY + dy * radius * 0.82)
  }
  context.stroke()

  const knobRadius = radius * 0.3
  const knobX      = centerX + style.offsetX * radius * 0.66
  const knobY      = centerY + style.offsetY * radius * 0.66

  context.globalAlpha = 1
  drawPlate(context, {
    x:      knobX - knobRadius,
    y:      knobY - knobRadius,
    width:  knobRadius * 2,
    height: knobRadius * 2,
  }, { accent, active: style.engaged, chamfer: 0.34, plain: true })

  if (style.label)
    drawPlateLabel(context, style.label, centerX, centerY - radius - 13, { size: 11, alpha: 0.5, color: accent })

  context.restore()
}
