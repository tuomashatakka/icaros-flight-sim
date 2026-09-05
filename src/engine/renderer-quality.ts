export const RENDERER_QUALITY_LEVELS = [ 'off', 'low', 'medium', 'high' ] as const

export type RendererQuality = typeof RENDERER_QUALITY_LEVELS[number]

export type RendererQualityPreset = {
  resolutionScale: number;
  bloom:           boolean;
  anamorphic:      boolean;
  radialBlur:      boolean;
  grade:           boolean;
  chromatic:       number;

  /** Upper bound for full-screen traversals after the scene draw. */
  traversalBudget: number;
}

/** One source of truth for render scale and effect cost across scenes. */
export const RENDERER_QUALITY: Record<RendererQuality, RendererQualityPreset> = {
  off:    { resolutionScale: 0.65, bloom: false, anamorphic: false, radialBlur: false, grade: false, chromatic: 0, traversalBudget: 0 },
  low:    { resolutionScale: 0.75, bloom: false, anamorphic: false, radialBlur: false, grade: false, chromatic: 0, traversalBudget: 0 },
  medium: { resolutionScale: 0.9, bloom: true, anamorphic: false, radialBlur: false, grade: true, chromatic: 0, traversalBudget: 2 },
  high:   { resolutionScale: 1, bloom: true, anamorphic: true, radialBlur: true, grade: true, chromatic: 0.4, traversalBudget: 4 },
}

export function resolveRendererQuality (): RendererQuality {
  if (typeof window === 'undefined')
    return 'low'

  if (process.env.NODE_ENV !== 'production') {
    const override = new URLSearchParams(window.location.search).get('post')
    if (RENDERER_QUALITY_LEVELS.some(level => level === override))
      return override as RendererQuality
  }

  const cores  = navigator.hardwareConcurrency ?? 4
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  if (coarse || cores < 6)
    return 'low'
  return cores >= 10 ? 'high' : 'medium'
}

/** Drawing-buffer pixels for a tier, shared by runtime sizing and benchmarks. */
type QualityBufferSizeReturnType = { width: number; height: number }

export function qualityBufferSize (
  quality: RendererQuality,
  width: number,
  height: number,
  devicePixelRatio = 1
): QualityBufferSizeReturnType {
  const ratio = Math.min(2, devicePixelRatio) * RENDERER_QUALITY[quality].resolutionScale
  return { width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)) }
}

export type RenderBenchmark = {
  quality:        RendererQuality | 'direct';
  cameraPose:     readonly [number, number, number, number, number, number, number];
  drawingBuffer:  Readonly<{ width: number; height: number }>;
  fragmentPixels: number;
}

/** Comparable workload estimate: fixed pose and buffer, only the chain varies. */
export function benchmarkRenderPreset (
  quality: RendererQuality | 'direct',
  cameraPose: RenderBenchmark['cameraPose'],
  drawingBuffer: RenderBenchmark['drawingBuffer']
): RenderBenchmark {
  const traversals     = quality === 'direct' ? 0 : RENDERER_QUALITY[quality].traversalBudget
  const fragmentPixels = drawingBuffer.width * drawingBuffer.height * (1 + traversals)
  return { quality, cameraPose, drawingBuffer, fragmentPixels }
}

/** Debounces the expensive dispose/recreate boundary for GPU render targets. */
type CreateQualityTransitionReturnType = { request(quality: RendererQuality): void; dispose(): void }

export function createQualityTransition (
  initial: RendererQuality,
  apply: (quality: RendererQuality) => void,
  delay = 300
): CreateQualityTransitionReturnType {
  let current                                     = initial
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    request (quality) {
      if (quality === current)
        return
      if (timer)
        clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        current = quality
        apply(quality)
      }, delay)
    },
    dispose () {
      if (timer)
        clearTimeout(timer)
      timer = null
    },
  }
}
