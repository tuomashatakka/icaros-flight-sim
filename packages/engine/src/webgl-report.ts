// What the device says about itself when a scene dies.
//
// The failure this exists for only happens on real phones: the scene draws for
// about a second and then the context goes away. None of it reproduces in
// headless chromium, and a phone has no console to read, so the report is
// rendered on screen where it can be screenshotted.
import * as THREE from 'three'
import type { AnyApp } from './types'


/**
 * Facts about the device, read while the context is still alive.
 *
 * A lost context refuses `getParameter`, so asking which GPU is in the phone at
 * the moment the scene dies returns nothing — exactly when it matters most.
 * These are captured on mount and kept for the report.
 */
export type DeviceInfo = {
  renderer?:       string;
  vendor?:         string;
  maxTextureSize?: number;
  drawingBuffer?:  string;
}

/**
 * Read the device's own identification from a live context.
 *
 * @param app - A mounted app, before anything has gone wrong.
 * @returns What the driver will admit to; empty when the extension is blocked,
 * which several privacy-hardened browsers do.
 */
export function captureDeviceInfo (app: AnyApp): DeviceInfo {
  const info: DeviceInfo = {}

  try {
    const gl    = app.ctx.renderer.getContext()
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    if (debug) {
      info.renderer = String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL))
      info.vendor   = String(gl.getParameter(debug.UNMASKED_VENDOR_WEBGL))
    }

    info.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number

    const size         = app.ctx.renderer.getDrawingBufferSize(new THREE.Vector2())
    info.drawingBuffer = `${size.x}x${size.y}`
  }
  catch {
    // Nothing to report is itself worth reporting.
  }

  return info
}

export type WebglReport = {

  /** What ended the scene: never started, or died after N seconds of drawing. */
  phase: 'create-failed' | 'context-lost';

  /**
   * Seconds of successful drawing before the context went away. The number that
   * separates "asked for too much up front" from "ran out of room while
   * running" — and the one the bug report keeps citing as "about a second".
   */
  aliveSeconds?: number;

  /**
   * The driver's own words. Chrome fills `statusMessage` on the
   * `webglcontextlost` event with the reason the context was dropped —
   * "GPU process crashed", an out-of-memory notice, a driver reset.
   */
  statusMessage?: string;

  /**
   * Does a 1x1 context still work? This is the discriminator. If a minimal
   * context is granted, the browser is not out of contexts and WebGL is not
   * disabled — the scene asked for more than the device would give. If even
   * this fails, the budget is gone or WebGL is off entirely.
   */
  minimalContextWorks: boolean;

  renderer?:       string;
  vendor?:         string;
  maxTextureSize?: number;
  drawingBuffer?:  string;
  pixelRatio?:     number;

  /** three's own resource census at the moment of death. */
  resources?: string;
  memoryMB?:  number;
  error?:     string;
}

/**
 * Ask for the smallest context a browser can give.
 *
 * Deliberately 1x1 and immediately released: it costs nothing to hand out, so a
 * refusal means the device is out of contexts or has WebGL disabled, while a
 * success means the scene's own demands were what got refused.
 */
function minimalContextWorks (): boolean {
  try {
    const probe = document.createElement('canvas')
    probe.width = probe.height = 1

    const gl    = probe.getContext('webgl2')
    if (!gl)
      return false

    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return true
  }
  catch {
    return false
  }
}

type PerformanceWithMemory = Performance & { memory?: { usedJSHeapSize: number }}

function heapMB (): number | undefined {
  const memory = (performance as PerformanceWithMemory).memory
  return memory ? Math.round(memory.usedJSHeapSize / 1e6) : undefined
}

/**
 * Collect everything worth knowing about a scene that failed.
 *
 * @param phase - Whether the context was never granted or was taken away.
 * @param app - The live app, when there was one; its renderer still answers
 * questions about limits and resource counts after the context is gone.
 * @param extra - Timing, the driver's status message, and the mount error.
 * @returns A flat, JSON-shaped report — safe to render, log, or paste.
 */
export function collectWebglReport (
  phase: WebglReport['phase'],
  app: AnyApp | null,
  extra: {
    aliveSeconds?:  number;
    statusMessage?: string;
    error?:         unknown;

    /** Captured by {@link captureDeviceInfo} while the context still answered. */
    device?: DeviceInfo;
  } = {}
): WebglReport {
  const report: WebglReport = {
    phase,
    aliveSeconds:        extra.aliveSeconds,
    statusMessage:       extra.statusMessage || undefined,
    minimalContextWorks: minimalContextWorks(),
    pixelRatio:          Number(window.devicePixelRatio.toFixed(2)),
    memoryMB:            heapMB(),
    error:               extra.error instanceof Error ? extra.error.message : undefined,
    ...extra.device,
  }

  const renderer = app?.ctx.renderer
  if (!renderer)
    return report

  // Read first: these are plain counters three keeps itself, so they survive a
  // context that has already gone and cannot throw on the way.
  try {
    const { geometries, textures } = renderer.info.memory
    const { calls, triangles }     = renderer.info.render

    report.resources = `${geometries} geom · ${textures} tex · ${renderer.info.programs?.length ?? 0} programs · ${calls} calls · ${triangles} tris`
  }
  catch {
    // Partial reports are still worth showing.
  }

  // Only worth trying when the caller had no chance to capture on mount; a lost
  // context refuses these, which is why `captureDeviceInfo` exists.
  if (!report.renderer)
    Object.assign(report, captureDeviceInfo(app as AnyApp))

  return report
}

/** One screenshottable line per fact. */
export function formatWebglReport (report: WebglReport): string[] {
  const lines = [
    report.phase === 'create-failed'
      ? 'context was never granted'
      : `context lost after ${report.aliveSeconds?.toFixed(1) ?? '?'}s of drawing`,
  ]

  if (report.statusMessage)
    lines.push(`driver: ${report.statusMessage}`)

  lines.push(`1x1 probe context: ${report.minimalContextWorks ? 'GRANTED' : 'REFUSED'}`)

  if (report.renderer)
    lines.push(`gpu: ${report.renderer}`)
  if (report.drawingBuffer)
    lines.push(`buffer: ${report.drawingBuffer}`)

  lines.push(`dpr: ${report.pixelRatio}${report.maxTextureSize ? ` · max tex ${report.maxTextureSize}` : ''}`)

  if (report.resources)
    lines.push(report.resources)
  if (report.memoryMB !== undefined)
    lines.push(`js heap: ${report.memoryMB} MB`)
  if (report.error)
    lines.push(report.error)

  return lines
}
