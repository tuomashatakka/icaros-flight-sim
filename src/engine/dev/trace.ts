import type { CapturedLog, FrameRecord } from './types'


/**
 * Rolling post-mortem buffer.
 *
 * The point is round-trips. Without this, "the CLI says it broke" is followed
 * by a second browser session to find out why; with it, the frame history, the
 * console output and the WebGL context state all come back in the same call
 * that reported the failure.
 *
 * Install is idempotent and happens once per page, independent of any scene, so
 * an error thrown during `mountRace` is still captured even though no app
 * exists to attach a harness to.
 */
const FRAME_CAPACITY = 600
const LOG_CAPACITY   = 200

const frames: FrameRecord[] = []
const logs: CapturedLog[]   = []

let installed      = false
let started        = 0
let contextLost    = false
let framesRecorded = 0

const now = () => typeof performance === 'undefined' ? Date.now() : performance.now()

function push<T> (buffer: T[], value: T, capacity: number) {
  buffer.push(value)
  if (buffer.length > capacity)
    buffer.shift()
}

/** Flatten console args without invoking getters or serialising the whole scene. */
function stringify (args: unknown[]): string {
  return args.map(arg => {
    if (typeof arg === 'string')
      return arg
    if (arg instanceof Error)
      return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`
    try {
      return JSON.stringify(arg)
    }
    catch {
      return String(arg)
    }
  }).join(' ')
}

export function installTrace (): void {
  if (installed || typeof window === 'undefined')
    return
  installed = true
  started   = now()

  for (const level of [ 'error', 'warn', 'log' ] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      push(logs, { t: +((now() - started) / 1000).toFixed(3), level, text: stringify(args) }, LOG_CAPACITY)
      original(...args)
    }
  }

  window.addEventListener('error', event => {
    push(logs, {
      t:     +((now() - started) / 1000).toFixed(3),
      level: 'error',
      text:  `[uncaught] ${event.message} @ ${event.filename}:${event.lineno}`,
    }, LOG_CAPACITY)
  })

  window.addEventListener('unhandledrejection', event => {
    push(logs, {
      t:     +((now() - started) / 1000).toFixed(3),
      level: 'error',
      text:  `[unhandled rejection] ${stringify([ event.reason ])}`,
    }, LOG_CAPACITY)
  })
}

/** Watch a canvas for context loss — the failure mode that looks like a hang. */
export function watchContextLoss (canvas: HTMLCanvasElement): () => void {
  const onLost = () => {
    contextLost = true
    push(logs, { t: +((now() - started) / 1000).toFixed(3), level: 'error', text: '[webgl] context lost' }, LOG_CAPACITY)
  }
  const onRestored = () => {
    contextLost = false
  }
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)
  return () => {
    canvas.removeEventListener('webglcontextlost', onLost)
    canvas.removeEventListener('webglcontextrestored', onRestored)
  }
}

/**
 * Frames discarded before timings start counting.
 *
 * The first frames include shader compilation and texture upload — one of them
 * is routinely 3 seconds long, which drags p95 up to meet the max and makes the
 * whole distribution useless for spotting a real regression.
 */
const WARMUP_FRAMES = 30

export function recordFrame (record: FrameRecord): void {
  framesRecorded++
  if (framesRecorded <= WARMUP_FRAMES)
    return
  push(frames, record, FRAME_CAPACITY)
}

/**
 * The whole post-mortem, JSON-safe.
 *
 * Frame times are reported as percentiles rather than raw rows: 600 numbers is
 * a lot of context to spend on a distribution that three values describe.
 */
export function readTrace () {
  const times  = frames.map(f => f.ms).sort((a, b) => a - b)
  const at     = (q: number) => times.length ? +times[Math.min(times.length - 1, Math.floor(times.length * q))].toFixed(2) : null
  const errors = logs.filter(l => l.level === 'error')

  return {
    framesRecorded,
    contextLost,
    frameMs: {
      p50: at(0.5),
      p95: at(0.95),
      max: times.length ? +times[times.length - 1].toFixed(2) : null,
    },
    fps:        times.length ? +(1000 / (at(0.5) ?? 1)).toFixed(1) : null,
    drawCalls:  frames.length ? frames[frames.length - 1].drawCalls : null,
    errorCount: errors.length,
    errors:     errors.slice(-20),
    logs:       logs.slice(-40),
  }
}

export function clearTrace (): void {
  frames.length = 0
  logs.length   = 0
  framesRecorded = 0
  contextLost = false
}
