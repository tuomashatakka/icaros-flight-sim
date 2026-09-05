// What the device says about itself when a scene dies.
//
// The failure this exists for only happens on real phones: the scene draws for
// about a second and then the context goes away. None of it reproduces in
// headless chromium, and a phone has no console to read, so the report is
// rendered on screen where it can be screenshotted.
import * as THREE from 'three'
import type { AnyApp } from './scene-canvas'


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

export type FramePercentiles = { p50: number | null; p95: number | null; p99: number | null; worst: number | null }

export type PerformanceCapture = {
  intervalSeconds:      number;
  frames:               number;
  frameMs:              FramePercentiles;
  gpuMs:                FramePercentiles | null;
  timing:               'gpu-and-cpu' | 'cpu-only';
  gpuTimer:             'ext_disjoint_timer_query_webgl2' | 'unavailable';
  longFrameThresholdMs: number;
  longFrames:           Array<{ atSeconds: number; ms: number }>;
  render: {
    drawCalls:  number;
    triangles:  number;
    programs:   number;
    textures:   number;
    geometries: number;
    target:     { width: number; height: number; pixelRatio: number };
  };
}

type TimerExtension = {
  TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number;
}

/** A non-blocking CPU/GPU sampler. Query results are read only after the driver marks them available. */
export function createPerformanceCapture (app: AnyApp) {
  const renderer                                             = app.ctx.renderer
  const gl                                                   = renderer.getContext() as WebGL2RenderingContext
  const ext                                                  = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null
  const frames: number[]                                     = []
  const gpu: number[]                                        = []
  const pending: WebGLQuery[]                                = []
  const started                                              = performance.now()
  const longFrames: Array<{ atSeconds: number; ms: number }> = []
  const peaks                                                = { drawCalls: 0, triangles: 0, programs: 0, textures: 0, geometries: 0 }
  let active: WebGLQuery | null = null
  let stopped                   = false
  let longFrameThresholdMs      = 16.67

  const percentiles = (values: number[]): FramePercentiles => {
    const sorted = [ ...values ].sort((a, b) => a - b)
    const at     = (q: number) => sorted.length
      ? +sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)].toFixed(2)
      : null
    return { p50: at(0.5), p95: at(0.95), p99: at(0.99), worst: at(1) }
  }
  const pollGpu = () => {
    if (!ext)
      return
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      for (const query of pending)
        gl.deleteQuery(query)
      pending.length = 0
      return
    }
    while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
      const query = pending.shift()!
      gpu.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6)
      gl.deleteQuery(query)
    }
  }

  return {
    setLongFrameThreshold (ms: number) {
      longFrameThresholdMs = ms
    },
    beginGpu () {
      pollGpu()
      if (!ext || active || stopped)
        return
      active = gl.createQuery()
      if (active)
        gl.beginQuery(ext.TIME_ELAPSED_EXT, active)
    },
    endGpu () {
      if (!ext || !active)
        return
      gl.endQuery(ext.TIME_ELAPSED_EXT)
      pending.push(active)
      active = null
    },
    frame (ms: number) {
      if (stopped)
        return
      frames.push(ms)
      if (ms > longFrameThresholdMs)
        longFrames.push({ atSeconds: +((performance.now() - started) / 1000).toFixed(3), ms: +ms.toFixed(2) })

      const info       = renderer.info
      peaks.drawCalls  = Math.max(peaks.drawCalls, info.render.calls)
      peaks.triangles  = Math.max(peaks.triangles, info.render.triangles)
      peaks.programs   = Math.max(peaks.programs, info.programs?.length ?? 0)
      peaks.textures   = Math.max(peaks.textures, info.memory.textures)
      peaks.geometries = Math.max(peaks.geometries, info.memory.geometries)
    },
    finish (intervalSeconds: number): PerformanceCapture {
      stopped = true
      pollGpu()

      const size = renderer.getDrawingBufferSize(new THREE.Vector2())
      return {
        intervalSeconds,
        frames:   frames.length,
        frameMs:  percentiles(frames),
        gpuMs:    gpu.length ? percentiles(gpu) : null,
        timing:   ext ? 'gpu-and-cpu' : 'cpu-only',
        gpuTimer: ext ? 'ext_disjoint_timer_query_webgl2' : 'unavailable',
        longFrameThresholdMs,
        longFrames,
        render:   { ...peaks, target: { width: size.x, height: size.y, pixelRatio: renderer.getPixelRatio() }},
      }
    },
  }
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
