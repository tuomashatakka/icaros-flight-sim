import * as THREE from 'three'
import type { HudPanelTrace, HudPanelUv } from './layout'
import { HUD_FONT as FONT } from './tokens'
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
  x:       number;
  y:       number;
  width:   number;
  height:  number;
  value:   number;
  label?:  string;
  color?:  string;
  color2?: string;
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

function roundedRect (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width * 0.5, height * 0.5)
  context.beginPath()
  context.moveTo(x + r, y)
  context.arcTo(x + width, y, x + width, y + height, r)
  context.arcTo(x + width, y + height, x, y + height, r)
  context.arcTo(x, y + height, x, y, r)
  context.arcTo(x, y, x + width, y, r)
  context.closePath()
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

function tracedPath (
  context: CanvasRenderingContext2D,
  trace: HudPanelTrace,
  width: number,
  height: number,
  inset = 1
): void {
  tracedLine(context, trace.contour, width, height, inset, true)
}

/**
 * One reference-style HUD facet.
 *
 * It owns the canvas, texture, drawing primitives, and the UV-space interaction
 * regions generated while drawing. The spatial compositor only has to place
 * the facet and route a raycast hit back here.
 */
export class HudPanel {
  readonly name:             string
  readonly canvas:           HTMLCanvasElement
  readonly context:          CanvasRenderingContext2D
  readonly texture:          THREE.CanvasTexture
  readonly regions:          HudRegion[] = []
  readonly interferenceSeed: number
  readonly trace?:           HudPanelTrace

  title:   string
  accent:  string
  center:  boolean
  hovered: string | null = null
  private contentTransformActive = false

  constructor ({
    name,
    title = '',
    accent = '#58f7ef',
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

    this.name             = name
    this.title            = title
    this.accent           = accent
    this.center           = center
    this.canvas           = canvas
    this.context          = context
    this.trace            = trace
    this.interferenceSeed = Array.from(name).reduce((seed, character) =>
      Math.imul(seed ^ character.charCodeAt(0), 16777619), 2166136261)
    this.texture                 = new THREE.CanvasTexture(canvas)
    this.texture.colorSpace      = THREE.SRGBColorSpace
    this.texture.minFilter       = THREE.LinearFilter
    this.texture.magFilter       = THREE.LinearFilter
    this.texture.generateMipmaps = false
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
      const glow = context.createRadialGradient(
        width * 0.5,
        height * 0.5,
        18,
        width * 0.5,
        height * 0.5,
        width * 0.48
      )
      glow.addColorStop(0, 'rgba(2, 12, 18, .02)')
      glow.addColorStop(0.62, 'rgba(2, 10, 17, .08)')
      glow.addColorStop(1, 'rgba(4, 6, 14, .18)')
      context.fillStyle = glow
      context.fillRect(0, 0, width, height)

      const corner        = 52
      context.strokeStyle = this.accent
      context.globalAlpha = 0.25
      context.lineWidth   = 2
      context.beginPath()
      context.moveTo(12, corner)
      context.lineTo(12, 12)
      context.lineTo(corner, 12)
      context.moveTo(width - corner, 12)
      context.lineTo(width - 12, 12)
      context.lineTo(width - 12, corner)
      context.moveTo(12, height - corner)
      context.lineTo(12, height - 12)
      context.lineTo(corner, height - 12)
      context.moveTo(width - corner, height - 12)
      context.lineTo(width - 12, height - 12)
      context.lineTo(width - 12, height - corner)
      context.stroke()
      context.globalAlpha = 1
      return
    }

    const background = context.createLinearGradient(0, 0, width, height)
    background.addColorStop(0, 'rgba(2, 14, 20, .58)')
    background.addColorStop(0.56, 'rgba(2, 8, 16, .48)')
    background.addColorStop(1, 'rgba(8, 3, 18, .52)')
    context.fillStyle = background
    if (this.trace) {
      context.strokeStyle = this.accent
      context.shadowColor = this.accent

      if (this.trace.variant === 'screen') {
        tracedPath(context, this.trace, width, height)
        context.globalAlpha = 0.72
        context.fill()
        context.lineWidth  = 2
        context.shadowBlur = 3
        context.stroke()
        tracedPath(context, this.trace, width, height, 0.965)
        context.globalAlpha = 0.2
        context.lineWidth   = 1.3
        context.shadowBlur  = 0
        context.stroke()
      }
      else {
        context.globalAlpha = 0.64
        context.lineWidth   = 2
        context.shadowBlur  = 3
        for (const stroke of this.trace.frame ?? []) {
          tracedLine(context, stroke, width, height)
          context.stroke()
        }
        context.shadowBlur = 0
      }

      const content = this.trace.content
      context.save()
      context.translate(content.x * width, content.y * height)
      context.scale(content.width, content.height)
      this.contentTransformActive = true
    }
    else {
      context.fillRect(0, 0, width, height)
      context.strokeStyle = this.accent
      context.globalAlpha = 0.62
      context.lineWidth   = 2
      context.strokeRect(10, 10, width - 20, height - 20)
      context.globalAlpha = 0.23
      context.strokeRect(20, 20, width - 40, height - 40)
    }

    context.globalAlpha  = 0.95
    context.fillStyle    = this.accent
    context.font         = `600 18px ${FONT}`
    context.textBaseline = 'middle'
    context.textAlign    = 'left'
    context.shadowColor  = this.accent
    context.shadowBlur   = 5
    context.fillText(this.title.toUpperCase(), 34, 36)
    context.shadowBlur  = 0
    context.globalAlpha = 0.25
    context.fillRect(34, 55, Math.min(width * 0.36, 210), 2)
    context.globalAlpha = 1
  }

  finish (elapsed: number): void {
    const { context, canvas } = this
    if (this.contentTransformActive) {
      context.restore()
      this.contentTransformActive = false
    }
    if (this.trace?.variant !== 'screen') {
      this.texture.needsUpdate = true
      return
    }

    context.save()

    let noise = this.interferenceSeed ^ Math.floor(elapsed * 13) | 0
    for (let i = 0; i < 8; i++) {
      noise ^= noise << 13
      noise ^= noise >>> 17
      noise ^= noise << 5

      const x = 12 + (noise >>> 0) % Math.max(1, canvas.width - 28)
      noise ^= noise << 13
      noise ^= noise >>> 17
      noise ^= noise << 5

      const y             = 12 + (noise >>> 0) % Math.max(1, canvas.height - 28)
      const size          = 2 + (noise >>> 27)
      context.globalAlpha = i % 5 === 0 ? 0.08 : 0.03
      context.fillStyle   = i % 3 === 0 ? this.accent : '#d7ffff'
      context.fillRect(x, y, size, Math.max(2, size * 0.55))
    }

    context.globalAlpha = 0.04
    context.fillStyle   = '#d7ffff'

    const scanY               = Math.floor(elapsed * 90 % canvas.height)
    context.fillRect(12, scanY, canvas.width - 24, 1)
    context.restore()
    this.texture.needsUpdate = true
  }

  text ({
    x,
    y,
    value,
    size = 18,
    color = '#d8ffff',
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
    context.shadowColor  = color
    context.shadowBlur   = Math.max(2, size * 0.16)
    context.fillText(value, x, y)
    context.shadowBlur  = 0
    context.globalAlpha = 1
  }

  bar ({
    x,
    y,
    width,
    height,
    value,
    label,
    color = this.accent,
    color2 = '#a58bff',
  }: BarOptions): void {
    const { context } = this
    const fillValue   = THREE.MathUtils.clamp(value, 0, 1)

    if (label) {
      context.font         = `500 15px ${FONT}`
      context.textAlign    = 'left'
      context.textBaseline = 'middle'
      context.fillStyle    = 'rgba(215, 248, 255, .68)'
      context.fillText(label.toUpperCase(), x, y - 12)
      context.textAlign = 'right'
      context.fillStyle = color
      context.fillText(`${Math.round(fillValue * 100)}%`, x + width, y - 12)
    }

    context.fillStyle = 'rgba(126, 168, 190, .14)'
    context.fillRect(x, y, width, height)

    const fill = context.createLinearGradient(x, 0, x + width, 0)
    fill.addColorStop(0, color)
    fill.addColorStop(1, color2)
    context.fillStyle   = fill
    context.shadowColor = color
    context.shadowBlur  = 5
    context.fillRect(x, y, width * fillValue, height)
    context.shadowBlur  = 0
    context.strokeStyle = 'rgba(210, 250, 255, .20)'
    context.strokeRect(x, y, width, height)

    for (let i = 1; i < 10; i++) {
      const px          = x + width * i / 10
      context.fillStyle = 'rgba(1, 5, 10, .35)'
      context.fillRect(px, y, 2, height)
    }
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

    roundedRect(context, x, y, width, height, 7)
    context.fillStyle = disabled
      ? 'rgba(8, 18, 28, .38)'
      : active
        ? `${color}33`
        : hovered
          ? 'rgba(180, 225, 255, .15)'
          : 'rgba(8, 18, 28, .74)'
    context.fill()
    context.lineWidth   = hovered ? 3 : 2
    context.strokeStyle = disabled
      ? 'rgba(150, 220, 235, .12)'
      : active
        ? color
        : hovered
          ? '#d9ffff'
          : 'rgba(150, 220, 235, .30)'
    context.stroke()
    if (active || hovered) {
      context.shadowColor = color
      context.shadowBlur  = 7
      context.stroke()
      context.shadowBlur = 0
    }
    context.font         = `${active ? 700 : 500} ${size}px ${FONT}`
    context.textAlign    = 'center'
    context.textBaseline = 'middle'
    context.fillStyle    = disabled ? 'rgba(220, 247, 250, .28)' : active ? color : 'rgba(220, 247, 250, .78)'
    context.fillText(label.toUpperCase(), x + width * 0.5, y + height * 0.5 + 1)

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

// perf: seven small canvas textures redraw at 12 hz; no allocations in the scene render path.
