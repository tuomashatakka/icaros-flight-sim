import * as THREE from 'three'
import type { HudPanelTrace, HudPanelUv } from './layout'
import {
  buildHudGrid,
  drawCornerBrackets,
  drawHeaderRule,
  drawPlate,
  drawPlateLabel,
  drawTickBar,
  glowStroke,
} from './chrome'
import {
  HUD_FONT_MONO as FONT,
  HUD_GRID_ALPHA,
  HUD_GRID_CELL,
  HUD_THEME as THEME,
} from './tokens'
import type { HudActionId, HudRegion } from './types'


type PanelOptions = {
  name:    string;
  title?:  string;
  accent?: string;
  width?:  number;
  height?: number;
  center?: boolean;
  trace?:  HudPanelTrace;
}

export type HudPanelMetrics = {
  drawMs:          number;
  draws:           number;
  textureUploads:  number;
  textureUploadHz: number;
}

const metrics = { drawMs: 0, draws: 0, textureUploads: 0, startedAt: performance.now() }

export function readHudPanelMetrics (): HudPanelMetrics {
  const seconds = Math.max((performance.now() - metrics.startedAt) / 1000, 0.001)
  return { ...metrics, textureUploadHz: metrics.textureUploads / seconds }
}

export function resetHudPanelMetrics (): void {
  metrics.drawMs         = 0
  metrics.draws          = 0
  metrics.textureUploads = 0
  metrics.startedAt      = performance.now()
}

type TextOptions = {
  x:       number;
  y:       number;
  value:   string;
  size?:   number;
  color?:  string;
  alpha?:  number;
  align?:  CanvasTextAlign;
  weight?: number;
}

type BarOptions = {
  x:      number;
  y:      number;
  width:  number;
  height: number;
  value:  number;
  label?: string;
  color?: string;
}

type ButtonOptions = {
  id:        string;
  x:         number;
  y:         number;
  width:     number;
  height:    number;
  label:     string;
  action:    HudActionId;
  kind?:     'button' | 'hold';
  active?:   boolean;
  disabled?: boolean;
  color?:    string;
  size?:     number;
}

function tracedLine (
  context: CanvasRenderingContext2D,
  points: readonly HudPanelUv[],
  width: number,
  height: number,
  inset = 1,
  close = false
): void {
  context.beginPath()
  points.forEach(([ u, v ], index) => {
    const tracedU = 0.5 + (u - 0.5) * inset
    const tracedV = 0.5 + (v - 0.5) * inset
    const x       = tracedU * width
    const y       = (1 - tracedV) * height
    if (index === 0)
      context.moveTo(x, y)
    else
      context.lineTo(x, y)
  })
  if (close)
    context.closePath()
}

/**
 * One reference-style HUD facet.
 *
 * It owns the canvas, texture, drawing primitives, and the UV-space interaction
 * regions generated while drawing. The spatial compositor only has to place
 * the facet and route a raycast hit back here.
 */
export class HudPanel {
  readonly name:    string
  readonly canvas:  HTMLCanvasElement
  readonly context: CanvasRenderingContext2D
  readonly texture: THREE.CanvasTexture
  readonly regions: HudRegion[] = []
  readonly trace?:  HudPanelTrace

  title:             string
  accent:            string
  center:            boolean
  hovered:           string | null = null
  private contentTransformActive = false
  private renderKey: string | null = null

  /** The glass fill, cached: it depends only on canvas size, never on a frame. */
  private glassFill: CanvasGradient | null = null

  constructor ({
    name,
    title = '',
    accent = THEME.primary,
    width = 640,
    height = 320,
    center = false,
    trace,
  }: PanelOptions) {
    const canvas  = document.createElement('canvas')
    canvas.width  = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context)
      throw new Error(`2d canvas unavailable for hud panel ${name}`)

    this.name                    = name
    this.title                   = title
    this.accent                  = accent
    this.center                  = center
    this.canvas                  = canvas
    this.context                 = context
    this.trace                   = trace
    this.texture                 = new THREE.CanvasTexture(canvas)
    this.texture.colorSpace      = THREE.SRGBColorSpace
    this.texture.minFilter       = THREE.LinearFilter
    this.texture.magFilter       = THREE.LinearFilter
    this.texture.generateMipmaps = false
  }

  /**
   * Resize the raster, and force the GPU allocation to follow it.
   *
   * `texture.dispose()` is the whole point of this method, and it is not
   * belt-and-braces. A `CanvasTexture` allocates IMMUTABLE storage on its first
   * upload — three calls `texStorage2D` once, when the source has no recorded
   * version, and every later upload is a `texSubImage2D` into that fixed
   * allocation. Resize the canvas afterwards and the sub-upload is out of
   * bounds: the driver rejects it (`glCopySubTextureCHROMIUM: Offset overflows
   * texture dimensions`), silently, and the texture keeps showing whatever was
   * uploaded FIRST, forever.
   *
   * That is exactly how the touch controls went missing on the deployed build
   * and nowhere else. The overlay is authored at 1280x720 and re-sized to the
   * viewport's true aspect on its first draw, so on a 16:9 monitor the size
   * never changes and nothing is wrong — while on a phone the first upload wins
   * and every frame after it is discarded. Whether the resize landed before or
   * after that first upload was a race between the resize observer and the
   * first rendered frame, which a slower dev build won and a production build
   * lost.
   *
   * Disposing clears the texture's cache key, so the next render builds a new
   * WebGLTexture and re-allocates at the size the canvas is now.
   *
   * @returns Whether the size actually changed.
   */
  resize (width: number, height: number): boolean {
    const nextWidth  = Math.max(1, Math.round(width))
    const nextHeight = Math.max(1, Math.round(height))
    if (this.canvas.width === nextWidth && this.canvas.height === nextHeight)
      return false

    this.canvas.width  = nextWidth
    this.canvas.height = nextHeight
    this.texture.dispose()
    this.texture.needsUpdate = true

    // Both are memoised against the old size, and the render key is what would
    // otherwise let a facet skip the redraw its new raster needs.
    this.glassFill = null
    this.renderKey = null
    return true
  }

  /** Draw and upload only when displayed state, interaction, or layout changed. */
  render (key: string, elapsed: number, draw: () => void): boolean {
    const renderKey = `${key}|${this.title}|${this.hovered ?? ''}|${this.canvas.width}x${this.canvas.height}`
    if (renderKey === this.renderKey)
      return false

    const started = performance.now()
    this.begin()
    draw()
    this.finish(elapsed)
    this.renderKey = renderKey
    metrics.drawMs += performance.now() - started
    metrics.draws++
    metrics.textureUploads++
    return true
  }

  /**
   * The dot-grid texture behind this panel's data area.
   *
   * Built once per panel size and memoised in `chrome.ts`'s cache — a repeat
   * call with the same dimensions costs a map lookup, not a redraw.
   */
  private grid (): HTMLCanvasElement {
    return buildHudGrid(this.canvas.width, this.canvas.height, this.accent, HUD_GRID_CELL, HUD_GRID_ALPHA, 'dot')
  }

  begin (): void {
    const { context, canvas } = this
    const width               = canvas.width
    const height              = canvas.height

    if (this.contentTransformActive) {
      context.restore()
      this.contentTransformActive = false
    }
    context.setTransform(1, 0, 0, 1, 0, 0)
    this.regions.length = 0
    context.clearRect(0, 0, width, height)

    if (this.center) {
      // A ring instrument, not a screen: brackets and a faint vignette only —
      // no filled rectangle standing in for a background.
      const glow = context.createRadialGradient(width * 0.5, height * 0.5, width * 0.32, width * 0.5, height * 0.5, width * 0.5)
      glow.addColorStop(0, 'rgba(2, 12, 18, 0)')
      glow.addColorStop(1, THEME.ink)
      context.fillStyle = glow
      context.fillRect(0, 0, width, height)

      drawCornerBrackets(context, { x: 0, y: 0, width, height }, this.accent, { len: 44, inset: 14, width: 2, alpha: 0.55 })
      return
    }

    if (this.trace) {
      if (!this.glassFill) {
        const fill = context.createLinearGradient(0, 0, width, height)
        fill.addColorStop(0, 'rgba(2, 14, 20, .58)')
        fill.addColorStop(0.56, 'rgba(2, 8, 16, .48)')
        fill.addColorStop(1, 'rgba(8, 3, 18, .52)')
        this.glassFill = fill
      }

      const drawContour = (inset: number) => tracedLine(context, this.trace!.contour, width, height, inset, true)

      if (this.trace.variant === 'screen') {
        drawContour(1)
        context.fillStyle = this.glassFill
        context.fill()
        glowStroke(context, () => drawContour(1), this.accent, 2, 0.68)
        glowStroke(context, ctx => tracedLine(ctx, this.trace!.contour, width, height, 0.965, true), this.accent, 1, 0.22)
      }
      else
        for (const stroke of this.trace.frame ?? [])
          glowStroke(context, ctx => tracedLine(ctx, stroke, width, height), this.accent, 1.8, 0.6)

      const content     = this.trace.content
      const contentRect = {
        x:      content.x * width,
        y:      content.y * height,
        width:  content.width * width,
        height: content.height * height,
      }
      context.save()
      context.drawImage(this.grid(), contentRect.x, contentRect.y, contentRect.width, contentRect.height,
                        contentRect.x, contentRect.y, contentRect.width, contentRect.height)
      context.restore()

      drawCornerBrackets(context, contentRect, this.accent, { len: 16, inset: 2 })
      if (this.title)
        drawHeaderRule(context, contentRect, this.title, this.accent)

      context.save()
      context.translate(content.x * width, content.y * height)
      context.scale(content.width, content.height)
      this.contentTransformActive = true
    }
    else {
      drawCornerBrackets(context, { x: 0, y: 0, width, height }, this.accent)
      context.drawImage(this.grid(), 0, 0)
      if (this.title)
        drawHeaderRule(context, { x: 0, y: 0, width, height }, this.title, this.accent)
    }
  }

  finish (_elapsed: number): void {
    const { context } = this
    if (this.contentTransformActive) {
      context.restore()
      this.contentTransformActive = false
    }
    this.texture.needsUpdate = true
  }

  text ({
    x,
    y,
    value,
    size = 18,
    color = THEME.pale,
    alpha = 0.92,
    align = 'left',
    weight = 500,
  }: TextOptions): void {
    const { context }    = this
    context.font         = `${weight} ${size}px ${FONT}`
    context.textAlign    = align
    context.textBaseline = 'middle'
    context.globalAlpha  = alpha
    context.fillStyle    = color
    context.fillText(value, x, y)
    context.globalAlpha = 1
  }

  /** A tick-marked instrument bar — see `chrome.ts#drawTickBar`. */
  bar ({
    x,
    y,
    width,
    height,
    value,
    label,
    color = this.accent,
  }: BarOptions): void {
    const fillValue = THREE.MathUtils.clamp(value, 0, 1)
    drawTickBar(this.context, { x, y, width, height }, fillValue, {
      color,
      label,
      valueLabel: label ? `${Math.round(fillValue * 100)}%` : undefined,
    })
  }

  button ({
    id,
    x,
    y,
    width,
    height,
    label,
    action,
    kind = 'button',
    active = false,
    disabled = false,
    color = this.accent,
    size = 16,
  }: ButtonOptions): void {
    const { context } = this
    const hovered     = this.hovered === id
    const rect        = { x, y, width, height }

    drawPlate(context, rect, { accent: color, active, hovered, disabled, chamfer: 0.16 })
    drawPlateLabel(context, label, x + width * 0.5, y + height * 0.5 + 1, {
      size,
      weight: active ? 700 : 500,
      color:  disabled ? THEME.dimmer : active ? color : THEME.pale,
      alpha:  disabled ? 0.4 : active ? 1 : 0.85,
    })

    if (!disabled)
      this.region({ id, kind, x, y, width, height, action })
  }

  region (region: HudRegion): void {
    const content = this.trace?.content
    if (!content) {
      this.regions.push(region)
      return
    }

    this.regions.push({
      ...region,
      x:      (content.x + region.x / this.canvas.width * content.width) * this.canvas.width,
      y:      (content.y + region.y / this.canvas.height * content.height) * this.canvas.height,
      width:  region.width * content.width,
      height: region.height * content.height,
    })
  }

  hitTest (x: number, y: number): HudRegion | null {
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const region = this.regions[i]
      if (x >= region.x && x <= region.x + region.width &&
          y >= region.y && y <= region.y + region.height)
        return region
    }
    return null
  }

  dispose (): void {
    if (this.contentTransformActive) {
      this.context.restore()
      this.contentTransformActive = false
    }
    this.texture.dispose()
    this.regions.length = 0
  }
}

// perf: seven small canvas textures redraw at up to 20 hz; the glass gradient and grid
// texture are built once per panel and reused every subsequent redraw.
