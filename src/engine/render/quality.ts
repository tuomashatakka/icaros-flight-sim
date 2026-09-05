export type RenderTier = 'low' | 'medium' | 'high'

export type QualitySnapshot = {
  tier:          RenderTier;
  scale:         number;
  cssSize:       [number, number];
  drawingBuffer: [number, number];
  transitions:   readonly QualityTransition[];
}

export type QualityTransition = {
  from:   number;
  to:     number;
  reason: 'startup' | 'slow' | 'stable';
  at:     number;
}

const reports = new WeakMap<object, () => QualitySnapshot>()

export function registerQualityReport (renderer: object, report: () => QualitySnapshot): void {
  reports.set(renderer, report)
}

export function readQualityReport (renderer: object): QualitySnapshot | undefined {
  return reports.get(renderer)?.()
}

export type QualityOptions = {
  desktopDprCap?: number;
  sampleFrames?:  number;
  missFrames?:    number;
  stableFrames?:  number;
  percentile?:    number;
  targetMs?:      number;
  step?:          number;
  minScale?:      number;
  windowFrames?:  number;
}

type MemoryNavigator = Navigator & { deviceMemory?: number }

export function detectRenderTier (canvas: HTMLCanvasElement): RenderTier {
  const probe = canvas.ownerDocument.createElement('canvas')
  const gl = probe.getContext('webgl2', { antialias: false, depth: false, stencil: false })
  const maxTexture = gl?.getParameter(gl.MAX_TEXTURE_SIZE) as number | undefined
  gl?.getExtension('WEBGL_lose_context')?.loseContext()

  const coarse        = matchMedia?.('(pointer: coarse)').matches ?? false
  const reducedMotion = matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  const memory        = (navigator as MemoryNavigator).deviceMemory
  const pixels        = Math.max(1, screen.width * screen.height)

  if (reducedMotion || (maxTexture ?? 4096) < 4096 || (memory !== undefined && memory <= 2) || (coarse && pixels <= 1_000_000))
    return 'low'
  if (coarse || (memory !== undefined && memory < 6) || (maxTexture ?? 8192) < 8192)
    return 'medium'
  return 'high'
}

export function tierDprCap (tier: RenderTier, desktopCap = 1.75): number {
  if (tier === 'low')
    return 1
  if (tier === 'medium')
    return 1.4
  return desktopCap
}

const quantile = (values: readonly number[], percentile: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentile))] ?? 0
}

export function createQualityController (
  tier: RenderTier,
  apply: (scale: number) => void,
  options: QualityOptions = {}
) {
  const sampleFrames = options.sampleFrames ?? 45
  const missFrames   = options.missFrames ?? 90
  const stableFrames = options.stableFrames ?? 360
  const percentile   = options.percentile ?? 0.9
  const targetMs     = options.targetMs ?? 16.7
  const step         = options.step ?? 0.1
  const minScale     = options.minScale ?? 0.6
  const windowFrames = options.windowFrames ?? 120
  const frames: number[] = []
  const transitions: QualityTransition[] = []
  let scale = 1
  let misses = 0
  let stable = 0
  let startupDone = false

  const change = (next: number, reason: QualityTransition['reason']) => {
    const quantised = +Math.max(minScale, Math.min(1, Math.round(next / step) * step)).toFixed(3)
    if (quantised === scale)
      return
    transitions.push({ from: scale, to: quantised, reason, at: performance.now() })
    scale = quantised
    apply(scale)
  }

  return {
    sample (milliseconds: number) {
      frames.push(milliseconds)
      if (frames.length > windowFrames)
        frames.shift()
      if (frames.length < sampleFrames)
        return

      const p = quantile(frames, percentile)
      if (p > targetMs * 1.12) {
        misses++
        stable = 0
      }
      else if (p < targetMs * 0.88) {
        stable++
        misses = 0
      }
      else {
        misses = stable = 0
      }

      if (!startupDone) {
        startupDone = true
        if (p > targetMs * 1.25)
          change(scale - step, 'startup')
      }
      else if (misses >= missFrames) {
        change(scale - step, 'slow')
        misses = 0
      }
      else if (stable >= stableFrames) {
        change(scale + step, 'stable')
        stable = 0
      }
    },
    get scale () { return scale },
    transitions,
    tier,
  }
}
