import { HUD_COLORS as COLORS } from './tokens'
import type { Rect } from './chrome'


/**
 * How HUD surfaces arrive and leave.
 *
 * Nothing faded before: the visor snapped into existence at mount, the tuning
 * popover appeared between two frames, and a finish screen replaced the world
 * with no transition at all. On a HUD built out of scanlines and chromatic
 * separation, an instant cut is the one effect that reads as a bug.
 *
 * The vocabulary is the facet shader's own — a wipe along the panel's own axis
 * with a bright leading edge, plus a chromatic offset that resolves as the wipe
 * completes. Shared here so the shader-drawn facets and the canvas-drawn
 * overlays are visibly the same mechanism rather than two lookalikes.
 */

/** Seconds for a surface to arrive or leave. */
export const HUD_TRANSITION_S = 0.42

/**
 * Ease for the wipe.
 *
 * Fast out of the gate and long in the tail: the leading edge should read as
 * something being scanned INTO existence, which a symmetric curve does not do.
 */
export function hudEase (t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return 1 - Math.pow(1 - x, 3)
}

export type HudReveal = {

  /** Open or close. Idempotent — re-setting the current target does nothing. */
  set(open: boolean, elapsed: number): void;

  /** 0 (gone) .. 1 (fully present), eased. */
  value(elapsed: number): number;

  /** True while the surface is anything other than fully closed. */
  live(elapsed: number): boolean;

  /** True while the surface is animating OUT rather than in. */
  closing(): boolean;

  /** Jump to a state with no animation — mount, or a mode swap. */
  snap(open: boolean): void;
}

export function createHudReveal (open = false): HudReveal {
  let target    = open ? 1 : 0
  let from      = target
  let startedAt = -Infinity

  function raw (elapsed: number): number {
    if (startedAt === -Infinity)
      return target

    const t = Math.max(0, Math.min(1, (elapsed - startedAt) / HUD_TRANSITION_S))
    return from + (target - from) * t
  }

  return {
    set (next, elapsed) {
      const wanted = next ? 1 : 0
      if (wanted === target)
        return
      from      = raw(elapsed)
      target    = wanted
      startedAt = elapsed
    },

    value (elapsed) {
      return hudEase(raw(elapsed))
    },

    live (elapsed) {
      return raw(elapsed) > 0.001
    },

    closing () {
      return target === 0
    },

    snap (next) {
      target    = next ? 1 : 0
      from      = target
      startedAt = -Infinity
    },
  }
}

/**
 * Clip a canvas surface to the part of it that has arrived, and draw the
 * leading edge.
 *
 * Call inside a `save()`/`restore()` pair: it installs a clip. At `phase >= 1`
 * it is a no-op beyond the save, so a settled surface pays nothing.
 */
export function clipReveal (
  context: CanvasRenderingContext2D,
  rect: Rect,
  phase: number,
  accent: string = COLORS.cyan
): void {
  if (phase >= 0.999)
    return

  // A slight shear on the wipe front, so the edge rakes across the surface the
  // way the facet shader's scanline does rather than dropping like a blind.
  const shear = rect.width * 0.06
  const swept = rect.height * phase
  const edgeY = rect.y + swept

  context.beginPath()
  context.moveTo(rect.x, rect.y)
  context.lineTo(rect.x + rect.width, rect.y)
  context.lineTo(rect.x + rect.width, edgeY)
  context.lineTo(rect.x, edgeY + shear * 0.5)
  context.closePath()
  context.clip()

  context.save()
  context.globalAlpha = 0.9
  context.strokeStyle = accent
  context.lineWidth   = 2
  context.shadowColor = accent
  context.shadowBlur  = 12
  context.beginPath()
  context.moveTo(rect.x, edgeY + shear * 0.5)
  context.lineTo(rect.x + rect.width, edgeY)
  context.stroke()
  context.restore()
}

/** Global alpha for a surface mid-transition, so a wipe also fades. */
export function revealAlpha (phase: number): number {
  return 0.15 + 0.85 * Math.max(0, Math.min(1, phase))
}
