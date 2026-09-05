export type QualityPreference = 'auto' | 'low' | 'medium' | 'high'

export type QualitySettings = {
  effects:         0 | 1 | 2;
  shadowSize:      512 | 1024 | 2048;
  particleScale:   number;
  hudHz:           15 | 30 | 60;
  lodScale:        number;
  resolutionScale: number;
}

export type QualityMeasurements = {
  sampleCount:        number;
  p50Ms:              number;
  p95Ms:              number;
  p99Ms:              number;
  gpuMs:              number | null;
  longFrameFrequency: number;
  width:              number;
  height:             number;
  pixels:             number;
}

export type QualityTransition = {
  at:           number;
  from:         number;
  to:           number;
  direction:    'degrade' | 'recover';
  reason:       'frame-budget' | 'stable';
  emergency:    boolean;
  measurements: QualityMeasurements;
  settings:     QualitySettings;
}

export type QualitySnapshot = {
  preference:   QualityPreference;
  stage:        number;
  warmingUp:    boolean;
  settings:     QualitySettings;
  measurements: QualityMeasurements;
  transitions:  readonly QualityTransition[];
}

export type QualityController = {
  frame(frameMs: number, gpuMs?: number | null): void;
  resize(width: number, height: number): void;
  setPreference(preference: QualityPreference): void;
  snapshot(): QualitySnapshot;
}

const WINDOW_SIZE    = 240
const WARMUP_SAMPLES = 120
const EVALUATE_EVERY = 30
const COOLDOWN_MS    = 8_000
const RECOVERY_MS    = 30_000
const LONG_FRAME_MS  = 25
const HISTORY_LIMIT  = 64

// Each step changes exactly one concern. That makes the degradation order a
// contract rather than a collection of interacting preset blobs.
export const QUALITY_STAGES: readonly QualitySettings[] = [
  { effects: 2, shadowSize: 2048, particleScale: 1, hudHz: 60, lodScale: 1, resolutionScale: 1 },
  { effects: 1, shadowSize: 2048, particleScale: 1, hudHz: 60, lodScale: 1, resolutionScale: 1 },
  { effects: 1, shadowSize: 1024, particleScale: 1, hudHz: 60, lodScale: 1, resolutionScale: 1 },
  { effects: 1, shadowSize: 1024, particleScale: 0.65, hudHz: 60, lodScale: 1, resolutionScale: 1 },
  { effects: 1, shadowSize: 1024, particleScale: 0.65, hudHz: 30, lodScale: 1, resolutionScale: 1 },
  { effects: 1, shadowSize: 1024, particleScale: 0.65, hudHz: 30, lodScale: 0.8, resolutionScale: 1 },
  { effects: 1, shadowSize: 1024, particleScale: 0.65, hudHz: 30, lodScale: 0.8, resolutionScale: 0.9 },
  { effects: 0, shadowSize: 1024, particleScale: 0.65, hudHz: 30, lodScale: 0.8, resolutionScale: 0.9 },
  { effects: 0, shadowSize: 512, particleScale: 0.65, hudHz: 30, lodScale: 0.8, resolutionScale: 0.9 },
  { effects: 0, shadowSize: 512, particleScale: 0.4, hudHz: 30, lodScale: 0.8, resolutionScale: 0.9 },
  { effects: 0, shadowSize: 512, particleScale: 0.4, hudHz: 15, lodScale: 0.8, resolutionScale: 0.9 },
  { effects: 0, shadowSize: 512, particleScale: 0.4, hudHz: 15, lodScale: 0.65, resolutionScale: 0.9 },
  { effects: 0, shadowSize: 512, particleScale: 0.4, hudHz: 15, lodScale: 0.65, resolutionScale: 0.8 },
  { effects: 0, shadowSize: 512, particleScale: 0.25, hudHz: 15, lodScale: 0.65, resolutionScale: 0.8 },
  { effects: 0, shadowSize: 512, particleScale: 0.25, hudHz: 15, lodScale: 0.5, resolutionScale: 0.8 },
  { effects: 0, shadowSize: 512, particleScale: 0.25, hudHz: 15, lodScale: 0.5, resolutionScale: 0.7 },
] as const

const preferenceStage = (preference: QualityPreference) => ({ auto: 0, high: 0, medium: 3, low: 12 })[preference]

function percentile (values: readonly number[], fraction: number): number {
  if (values.length === 0)
    return 0

  const sorted = [ ...values ].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
}

export function startupQualityPreference (): QualityPreference {
  if (typeof window === 'undefined')
    return 'low'

  const cores  = navigator.hardwareConcurrency ?? 4
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  return coarse || cores <= 4 || memory <= 4 ? 'low' : cores < 8 ? 'medium' : 'high'
}

export function createQualityController (options: {
  preference?:        QualityPreference;
  initialPreference?: QualityPreference;
  now?:               () => number;
  onTransition?:      (transition: QualityTransition) => void;
} = {}): QualityController {
  const now               = options.now ?? performance.now.bind(performance)
  let preference          = options.preference ?? 'auto'
  const startup           = options.initialPreference ?? startupQualityPreference()
  let stage               = preferenceStage(preference === 'auto' ? startup : preference)
  let width               = 0
  let height              = 0
  let framesSinceEvaluate = 0
  let lastTransitionAt    = -Infinity
  let stableSince         = now()
  const frames: number[]                 = []
  const gpuFrames: number[]              = []
  const transitions: QualityTransition[] = []

  const measurements = (): QualityMeasurements => ({
    sampleCount:        frames.length,
    p50Ms:              percentile(frames, 0.5),
    p95Ms:              percentile(frames, 0.95),
    p99Ms:              percentile(frames, 0.99),
    gpuMs:              gpuFrames.length ? percentile(gpuFrames, 0.95) : null,
    longFrameFrequency: frames.filter(value => value >= LONG_FRAME_MS).length / Math.max(1, frames.length),
    width,
    height,
    pixels:             width * height * QUALITY_STAGES[stage].resolutionScale ** 2,
  })

  const move = (to: number, reason: QualityTransition['reason'], emergency: boolean) => {
    const at                            = now()
    const transition: QualityTransition = {
      at,
      from:         stage,
      to,
      direction:    to > stage ? 'degrade' : 'recover',
      reason,
      emergency,
      measurements: measurements(),
      settings:     QUALITY_STAGES[to],
    }
    stage            = to
    lastTransitionAt = at
    stableSince      = at
    transitions.push(transition)
    if (transitions.length > HISTORY_LIMIT)
      transitions.shift()
    options.onTransition?.(transition)
  }

  return {
    frame (frameMs, gpuMs) {
      if (!Number.isFinite(frameMs) || frameMs <= 0)
        return
      frames.push(frameMs)
      if (frames.length > WINDOW_SIZE)
        frames.shift()
      if (gpuMs != null && Number.isFinite(gpuMs) && gpuMs > 0) {
        gpuFrames.push(gpuMs)
        if (gpuFrames.length > WINDOW_SIZE)
          gpuFrames.shift()
      }
      if (++framesSinceEvaluate < EVALUATE_EVERY || frames.length < WARMUP_SAMPLES)
        return
      framesSinceEvaluate = 0

      const at        = now()
      const sample    = measurements()
      const emergency = sample.p99Ms > 45 || sample.longFrameFrequency > 0.2
      const over      = sample.p95Ms > 20 || sample.gpuMs != null && sample.gpuMs > 18 || sample.longFrameFrequency > 0.08
      const cool      = at - lastTransitionAt >= COOLDOWN_MS
      if (over && cool && stage < QUALITY_STAGES.length - 1) {
        move(stage + 1, 'frame-budget', emergency)
        return
      }
      if (over) {
        stableSince = at
        return
      }

      const preferred = preferenceStage(preference)
      const healthy   = sample.p95Ms < 15 && (sample.gpuMs == null || sample.gpuMs < 13) && sample.longFrameFrequency < 0.015
      if (!healthy)
        stableSince = at
      else if (cool && at - stableSince >= RECOVERY_MS && stage > preferred)
        move(stage - 1, 'stable', false)
    },

    resize (nextWidth, nextHeight) {
      width  = Math.max(0, Math.round(nextWidth))
      height = Math.max(0, Math.round(nextHeight))
    },

    setPreference (next) {
      preference = next

      const requested = preferenceStage(next)
      // Preferences take effect immediately only when they are safer. Upgrades
      // still earn their way back through the stable-window path.
      if (requested > stage)
        move(requested, 'frame-budget', false)
    },

    snapshot: () => ({
      preference,
      stage,
      warmingUp:    frames.length < WARMUP_SAMPLES,
      settings:     QUALITY_STAGES[stage],
      measurements: measurements(),
      transitions:  [ ...transitions ],
    }),
  }
}
