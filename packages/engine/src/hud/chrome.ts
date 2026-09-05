import {
  HUD_BRACKET_INSET,
  HUD_BRACKET_LEN,
  HUD_CAPTION_SIZE,
  HUD_CAPTION_TRACKING,
  HUD_FONT_DISPLAY as DISPLAY_FONT,
  HUD_FONT_MONO as FONT,
  HUD_GLOW_ALPHA,
  HUD_GLOW_WIDE_ALPHA,
  HUD_GLOW_WIDE_SCALE,
  HUD_THEME as THEME,
} from './tokens'


/**
 * The HUD's drawing vocabulary, shared by every panel painter, the overlay
 * layer and the touch controls.
 *
 * The visor is built from cut-corner plates, doubled strokes, corner brackets
 * and a rolling scanline — never a filled rectangle standing in for a panel
 * background. Everything drawn on a facet, the overlay or a touch control
 * comes through here, so the three surfaces read as one instrument rather than
 * three lookalikes.
 */

const TAU = Math.PI * 2

export type Rect = { x: number; y: number; width: number; height: number }

// --- glow --------------------------------------------------------------------
// A wide, low-alpha pass under a thin, bright one — two flat draws instead of
// `shadowBlur`'s per-pixel convolution, which is slow at HUD cadence.

/** Stroke `drawPath` twice: a soft wide halo, then a crisp bright line. */
export function glowStroke (
  context: CanvasRenderingContext2D,
  drawPath: (context: CanvasRenderingContext2D) => void,
  color: string,
  width = 1.6,
  alpha = HUD_GLOW_ALPHA
): void {
  context.save()
  context.strokeStyle = color
  context.lineJoin    = 'round'
  context.lineCap     = 'round'

  context.globalAlpha = alpha * HUD_GLOW_WIDE_ALPHA
  context.lineWidth   = width * HUD_GLOW_WIDE_SCALE
  context.beginPath()
  drawPath(context)
  context.stroke()

  context.globalAlpha = alpha
  context.lineWidth   = width
  context.beginPath()
  drawPath(context)
  context.stroke()
  context.restore()
}

/** Fill `value` twice: a soft oversized halo, then the crisp glyph. */
export function glowText (
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  color: string,
  size = 14,
  align: CanvasTextAlign = 'left',
  weight = 600,
  font: string = FONT
): void {
  context.save()
  context.textAlign    = align
  context.textBaseline = 'middle'
  context.fillStyle    = color

  context.font        = `${weight} ${size * 1.14}px ${font}`
  context.globalAlpha = HUD_GLOW_WIDE_ALPHA
  context.fillText(value, x, y)

  context.font        = `${weight} ${size}px ${font}`
  context.globalAlpha = HUD_GLOW_ALPHA
  context.fillText(value, x, y)
  context.restore()
}

// --- tracked type --------------------------------------------------------------

export type TrackedTextOptions = {
  size?:     number;
  color?:    string;
  alpha?:    number;
  tracking?: number;
  align?:    'left' | 'center' | 'right';
  font?:     string;
  weight?:   number;
  glow?:     boolean;
}

/** Draw each glyph of `text` left-to-right from `startX`, advancing by its measured width plus tracking. */
function advanceGlyphs (
  context: CanvasRenderingContext2D,
  text: string,
  startX: number,
  y: number,
  tracking: number
): void {
  let cursor = startX
  for (const glyph of text) {
    context.fillText(glyph, cursor, y)
    cursor += context.measureText(glyph).width + tracking
  }
}

/**
 * Uppercase caption with manual letter-spacing.
 *
 * `CanvasRenderingContext2D.letterSpacing` is not on every engine this ships
 * to; measuring and re-advancing per glyph is three extra calls and works
 * everywhere.
 */
export function drawTrackedText (
  context: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  options: TrackedTextOptions = {}
): void {
  const text     = value.toUpperCase()
  const size     = options.size ?? HUD_CAPTION_SIZE
  const color    = options.color ?? THEME.primary
  const tracking = options.tracking ?? HUD_CAPTION_TRACKING
  const align    = options.align ?? 'left'
  const font     = options.font ?? DISPLAY_FONT
  const weight   = options.weight ?? 600

  context.save()
  context.font         = `${weight} ${size}px ${font}`
  context.textAlign    = 'left'
  context.textBaseline = 'middle'
  context.globalAlpha  = options.alpha ?? 0.85
  context.fillStyle    = color

  let width = 0
  for (const glyph of text)
    width += context.measureText(glyph).width + tracking
  width -= text.length > 0 ? tracking : 0

  const cursor = align === 'left' ? x : align === 'right' ? x - width : x - width * 0.5

  if (options.glow) {
    context.font        = `${weight} ${size * 1.14}px ${font}`

    const settledAlpha  = context.globalAlpha
    context.globalAlpha = HUD_GLOW_WIDE_ALPHA
    advanceGlyphs(context, text, cursor, y, tracking)
    context.font        = `${weight} ${size}px ${font}`
    context.globalAlpha = settledAlpha
  }

  advanceGlyphs(context, text, cursor, y, tracking)
  context.restore()
}

// --- panel chrome --------------------------------------------------------------

export type CornerBracketOptions = {
  len?:   number;
  inset?: number;
  width?: number;
  alpha?: number;
}

/** Four L-shaped corner ticks — the frame a real cockpit pane is cut into. */
export function drawCornerBrackets (
  context: CanvasRenderingContext2D,
  rect: Rect,
  color: string,
  options: CornerBracketOptions = {}
): void {
  const len                     = options.len ?? HUD_BRACKET_LEN
  const inset                   = options.inset ?? HUD_BRACKET_INSET
  const { x, y, width, height } = rect
  const left                    = x + inset
  const right                   = x + width - inset
  const top                     = y + inset
  const bottom                  = y + height - inset

  glowStroke(context, ctx => {
    ctx.moveTo(left, top + len)
    ctx.lineTo(left, top)
    ctx.lineTo(left + len, top)

    ctx.moveTo(right - len, top)
    ctx.lineTo(right, top)
    ctx.lineTo(right, top + len)

    ctx.moveTo(right, bottom - len)
    ctx.lineTo(right, bottom)
    ctx.lineTo(right - len, bottom)

    ctx.moveTo(left + len, bottom)
    ctx.lineTo(left, bottom)
    ctx.lineTo(left, bottom - len)
  }, color, options.width ?? 2, options.alpha ?? HUD_GLOW_ALPHA)
}

/** A hairline rule with a tracked caption riding it — a panel's header. */
export function drawHeaderRule (
  context: CanvasRenderingContext2D,
  rect: Rect,
  caption: string,
  color: string
): void {
  const y = rect.y + HUD_BRACKET_INSET + 16
  drawTrackedText(context, caption, rect.x + HUD_BRACKET_INSET + 2, y, { color, alpha: 0.82, glow: true })

  context.save()
  context.strokeStyle = color
  context.globalAlpha = 0.4
  context.lineWidth   = 1
  context.beginPath()
  context.moveTo(rect.x + HUD_BRACKET_INSET, y + 13)
  context.lineTo(rect.x + rect.width - HUD_BRACKET_INSET, y + 13)
  context.stroke()
  context.restore()
}

/** A thin rule between two data groups on the same panel. */
export function drawGroupRule (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  color: string = THEME.dim
): void {
  context.save()
  context.strokeStyle = color
  context.globalAlpha = 0.5
  context.lineWidth   = 1
  context.beginPath()
  context.moveTo(x, y)
  context.lineTo(x + width, y)
  context.stroke()
  context.restore()
}

const gridCache = new Map<string, HTMLCanvasElement>()

/**
 * A dot or hex texture at low alpha, meant to sit behind a data area.
 *
 * Built once per (size, cell, kind) and memoised process-wide — callers pass
 * the returned canvas straight to `drawImage`. Nothing here allocates on a
 * repeat call with the same key.
 */
export function buildHudGrid (
  width: number,
  height: number,
  color: string,
  cell: number,
  alpha: number,
  kind: 'dot' | 'hex' = 'dot'
): HTMLCanvasElement {
  const key    = `${kind}|${width}x${height}|${cell}|${alpha}|${color}`
  const cached = gridCache.get(key)
  if (cached)
    return cached

  const canvas  = document.createElement('canvas')
  canvas.width  = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context)
    return canvas

  context.strokeStyle = color
  context.fillStyle   = color
  context.globalAlpha = alpha

  if (kind === 'hex') {
    const r  = cell * 0.5
    const dx = r * 1.73205
    const dy = r * 1.5
    for (let row = -1, ry = -dy; ry < height + dy; row++, ry += dy) {
      const offset = row % 2 === 0 ? 0 : dx * 0.5
      for (let rx = -dx + offset; rx < width + dx; rx += dx) {
        context.beginPath()
        for (let i = 0; i < 6; i++) {
          const angle = Math.PI / 3 * i - Math.PI / 6
          const px    = rx + Math.cos(angle) * r
          const py    = ry + Math.sin(angle) * r
          if (i === 0)
            context.moveTo(px, py)
          else
            context.lineTo(px, py)
        }
        context.closePath()
        context.lineWidth = 1
        context.stroke()
      }
    }
  }
  else
    for (let py = cell * 0.5; py < height; py += cell)
      for (let px = cell * 0.5; px < width; px += cell) {
        context.beginPath()
        context.arc(px, py, 1, 0, TAU)
        context.fill()
      }

  gridCache.set(key, canvas)
  return canvas
}

// --- bars ------------------------------------------------------------------

export type SegmentedBarOptions = {
  segments?:      number;
  gap?:           number;
  color:          string;
  criticalColor?: string;
  criticalBelow?: number;
  vertical?:      boolean;

  /** Fill from the far end instead of the near one — two bars meeting head-on. */
  reverse?:    boolean;
  label?:      string;
  valueLabel?: string;
}

/**
 * Chunky ED-style segments with 1 px gaps — throttle, boost, capacitors,
 * team scores. A meter that reads as discrete rounds spent, not a fluid fill.
 */
function fillVerticalSegments (
  context: CanvasRenderingContext2D,
  rect: Rect,
  segments: number,
  gap: number,
  lit: number,
  reverse: boolean,
  color: string
): void {
  const segH = (rect.height - gap * (segments - 1)) / segments
  for (let i = 0; i < segments; i++) {
    const on            = reverse ? i < lit : i >= segments - lit
    const row           = reverse ? segments - 1 - i : i
    const y             = rect.y + rect.height - (row + 1) * (segH + gap) + gap
    context.globalAlpha = on ? 0.92 : 0.14
    context.fillStyle   = on ? color : THEME.dimmer
    context.fillRect(rect.x, y, rect.width, segH)
  }
}

function fillHorizontalSegments (
  context: CanvasRenderingContext2D,
  rect: Rect,
  segments: number,
  gap: number,
  lit: number,
  reverse: boolean,
  color: string
): void {
  const segW = (rect.width - gap * (segments - 1)) / segments
  for (let i = 0; i < segments; i++) {
    const on            = reverse ? i >= segments - lit : i < lit
    const x             = rect.x + i * (segW + gap)
    context.globalAlpha = on ? 0.92 : 0.14
    context.fillStyle   = on ? color : THEME.dimmer
    context.fillRect(x, rect.y, segW, rect.height)
  }
}

/** Chunky ED-style segments with 1 px gaps — throttle, boost, capacitors, scores. */
export function drawSegmentedBar (
  context: CanvasRenderingContext2D,
  rect: Rect,
  value: number,
  options: SegmentedBarOptions
): void {
  const segments = options.segments ?? 14
  const gap      = options.gap ?? 1.5
  const clamped  = Math.max(0, Math.min(1, value))
  const lit      = Math.round(clamped * segments)
  const critical = options.criticalBelow !== undefined && clamped < options.criticalBelow
  const color    = critical ? options.criticalColor ?? THEME.red : options.color
  const labelY   = rect.y - (options.vertical ? 0 : 12)

  if (options.label)
    drawTrackedText(context, options.label, rect.x, labelY, { size: 11, color: THEME.pale, alpha: 0.6, tracking: 1.6 })
  if (options.valueLabel)
    drawTrackedText(context, options.valueLabel, rect.x + rect.width, labelY, { size: 11, color, alpha: 0.85, tracking: 1.6, align: 'right' })

  context.save()
  if (options.vertical)
    fillVerticalSegments(context, rect, segments, gap, lit, options.reverse ?? false, color)
  else
    fillHorizontalSegments(context, rect, segments, gap, lit, options.reverse ?? false, color)

  context.globalAlpha = 1
  context.strokeStyle = THEME.dim
  context.lineWidth   = 1
  context.strokeRect(rect.x, rect.y, rect.width, rect.height)
  context.restore()
}

export type TickBarOptions = {
  color:       string;
  ticks?:      number;
  label?:      string;
  valueLabel?: string;
}

/**
 * A tick-marked progress bar for general meters — gate closure, alignment,
 * course position. Reads as an instrument rather than a web progress bar.
 */
export function drawTickBar (
  context: CanvasRenderingContext2D,
  rect: Rect,
  value: number,
  options: TickBarOptions
): void {
  const clamped = Math.max(0, Math.min(1, value))
  const ticks   = options.ticks ?? 20
  const color   = options.color

  if (options.label)
    drawTrackedText(context, options.label, rect.x, rect.y - 12, { size: 11, color: THEME.pale, alpha: 0.6, tracking: 1.6 })
  if (options.valueLabel)
    drawTrackedText(context, options.valueLabel, rect.x + rect.width, rect.y - 12, { size: 11, color, alpha: 0.85, tracking: 1.6, align: 'right' })

  context.save()
  context.fillStyle   = THEME.dimmer
  context.fillRect(rect.x, rect.y, rect.width, rect.height)
  context.fillStyle   = color
  context.globalAlpha = 0.82
  context.fillRect(rect.x, rect.y, rect.width * clamped, rect.height)
  context.globalAlpha = 1
  context.strokeStyle = THEME.dim
  context.lineWidth   = 1
  context.strokeRect(rect.x, rect.y, rect.width, rect.height)

  context.strokeStyle = THEME.inkSolid
  context.lineWidth   = 1
  for (let i = 1; i < ticks; i++) {
    const x = rect.x + rect.width * i / ticks
    context.beginPath()
    context.moveTo(x, rect.y)
    context.lineTo(x, rect.y + rect.height)
    context.stroke()
  }
  context.restore()
}

// --- surfaces (buttons, sticks) ------------------------------------------------

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

/** Fill, stroke, inner rule and glow — one HUD surface (button, stick knob). */
export function drawPlate (
  context: CanvasRenderingContext2D,
  rect: Rect,
  style: PlateStyle = {}
): void {
  const accent   = style.accent ?? THEME.primary
  const chamfer  = (style.chamfer ?? 0.22) * Math.min(rect.width, rect.height)
  const disabled = style.disabled ?? false

  context.save()
  context.globalAlpha = style.alpha ?? 1

  chamferPath(context, rect, chamfer)
  context.fillStyle = disabled
    ? THEME.dimmer
    : style.active
      ? `${accent}33`
      : style.hovered
        ? 'rgba(215, 248, 255, .12)'
        : THEME.ink
  context.fill()

  context.lineWidth   = style.hovered || style.active ? 2.5 : 1.8
  context.strokeStyle = disabled
    ? THEME.dimmer
    : style.active || style.hovered
      ? accent
      : THEME.dim
  context.stroke()

  if (style.active)
    glowStroke(context, ctx => chamferPath(ctx, rect, chamfer), accent, 2.5, 0.8)

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
  accent: string = THEME.primary
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
  context.fillStyle    = style.color ?? THEME.pale
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
  const accent = style.accent ?? THEME.primary

  context.save()

  context.fillStyle = THEME.ink
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
