import * as THREE from 'three'
import { HOLO } from './materials'

/** Device pixels per world unit of readout. Enough to stay crisp at cockpit FOV. */
const RESOLUTION = 256

export type Readout = {
  mesh: THREE.Mesh;

  /**
   * Set the displayed string.
   *
   * Redraws the canvas and re-uploads the texture ONLY when the string actually
   * changes. This guard is the whole reason the HUD can run at 60 Hz: a speed
   * readout changes maybe ten times a second, but a texture upload every frame
   * for every readout would dwarf everything else the HUD does.
   */
  set(text: string): void;

  setOpacity(value: number): void;
  dispose(): void;
}

export type ReadoutOptions = {

  /** Plane size in world units. The canvas is sized from this. */
  width:  number;
  height: number;

  color?: THREE.ColorRepresentation;

  /** CSS font shorthand, sized in canvas pixels. */
  font?:  string;
  align?: CanvasTextAlign;

  /** Drawn once behind the value, e.g. `SPD`. */
  label?: string;
}

/**
 * A numeric/text readout as a canvas-textured quad.
 *
 * Text is the one thing the holo shader cannot do — there is no SDF font in the
 * project and pulling one in for four readouts is not worth it. Canvas textures
 * are the pattern already used for ship liveries (`src/lib/ship/materials.ts`),
 * so this stays consistent with the codebase rather than introducing a second
 * text approach.
 */
export function createReadout (options: ReadoutOptions): Readout {
  const { width, height, align = 'center' } = options
  const color                               = new THREE.Color(options.color ?? HOLO.cyan)
  const font                                = options.font ?? `600 ${Math.round(height * RESOLUTION * 0.62)}px ui-monospace, monospace`

  const canvas  = document.createElement('canvas')
  canvas.width  = Math.max(2, Math.round(width * RESOLUTION))
  canvas.height = Math.max(2, Math.round(height * RESOLUTION))

  const ctx = canvas.getContext('2d')
  if (!ctx)
    throw new Error('2d canvas context unavailable for HUD readout')

  const texture           = new THREE.CanvasTexture(canvas)
  texture.colorSpace      = THREE.SRGBColorSpace
  texture.minFilter       = THREE.LinearFilter
  texture.generateMipmaps = false

  const material = new THREE.MeshBasicMaterial({
    map:         texture,
    transparent: true,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    depthTest:   false,
    toneMapped:  false,
    color:       color,
  })

  const geometry = new THREE.PlaneGeometry(width, height)
  const mesh     = new THREE.Mesh(geometry, material)

  let current: string | null = null

  const draw = (text: string) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font         = font
    ctx.textAlign    = align
    ctx.textBaseline = 'middle'
    ctx.fillStyle    = '#ffffff'

    const x = align === 'left'
      ? 0
      : align === 'right'
        ? canvas.width
        : canvas.width / 2

    if (options.label) {
      ctx.save()
      ctx.globalAlpha = 0.55
      ctx.font        = `500 ${Math.round(canvas.height * 0.26)}px ui-monospace, monospace`
      ctx.fillText(options.label, x, canvas.height * 0.16)
      ctx.restore()
      ctx.font = font
      ctx.fillText(text, x, canvas.height * 0.62)
    }
    else
      ctx.fillText(text, x, canvas.height / 2)

    texture.needsUpdate = true
  }

  draw('')

  return {
    mesh,

    set (text) {
      if (text === current)
        return
      current = text
      draw(text)
    },

    setOpacity (value) {
      material.opacity = value
      mesh.visible     = value > 0.01
    },

    dispose () {
      geometry.dispose()
      material.dispose()
      texture.dispose()
    },
  }
}
