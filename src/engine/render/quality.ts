export type RenderTier = 'low' | 'medium' | 'high'

export type RenderQuality = {
  tier:          RenderTier;
  pixelRatio:    number;
  antialias:     boolean;
  shadows:       boolean;
  shadowMapSize: number;
  post:          boolean;
  motion:        boolean;
}

const QUALITY: Record<RenderTier, Omit<RenderQuality, 'tier'>> = {
  low:    { pixelRatio: 1, antialias: false, shadows: false, shadowMapSize: 512, post: false, motion: false },
  medium: { pixelRatio: 1.25, antialias: true, shadows: true, shadowMapSize: 1024, post: false, motion: true },
  high:   { pixelRatio: 1.5, antialias: true, shadows: true, shadowMapSize: 2048, post: true, motion: true },
}

function requestedTier (): RenderTier | null {
  if (process.env.NODE_ENV === 'production' || typeof location === 'undefined')
    return null

  const value = new URLSearchParams(location.search).get('quality')
  return value === 'low' || value === 'medium' || value === 'high' ? value : null
}

/**
 * Start safe, then let measured frame time spend more pixels.
 *
 * CPU count is only a weak hint, so it never selects `high` on its own. A
 * coarse pointer is stronger evidence that fill-rate and battery matter more
 * than supersampling, while the URL override keeps profiling reproducible.
 */
export function resolveRenderQuality (): RenderQuality {
  const override      = requestedTier()
  const coarse        = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches
  const cores         = typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency ?? 4
  const tier          = override ?? (coarse || cores <= 4 ? 'low' : 'medium')
  const reducedMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  return { tier, ...QUALITY[tier], motion: QUALITY[tier].motion && !reducedMotion }
}

export type FrameBudget = {
  readonly pixelRatio: number;
  readonly p95Ms:      number;
  sample(delta: number): number | null;
}

/**
 * Dynamic resolution with a long recovery window and quantised changes.
 * React never sees it, and simulation time never depends on it.
 */
export function createFrameBudget (initialPixelRatio: number): FrameBudget {
  const samples = new Float32Array(120)
  let count    = 0
  let cursor   = 0
  let ratio    = initialPixelRatio
  let p95      = 0
  let cooldown = 0

  return {
    get pixelRatio () {
      return ratio
    },
    get p95Ms () {
      return p95
    },

    sample (delta) {
      // A backgrounded tab is not a slow GPU. Ignore its resumed mega-frame.
      if (delta <= 0 || delta > 0.25)
        return null

      samples[cursor] = delta * 1000
      cursor          = (cursor + 1) % samples.length
      count           = Math.min(samples.length, count + 1)
      if (count < samples.length)
        return null

      cooldown++
      if (cooldown < samples.length)
        return null
      cooldown = 0

      const ordered = Array.from(samples).sort((a, b) => a - b)
      p95           = ordered[Math.floor(ordered.length * 0.95)]

      const next    = p95 > 18.5
        ? Math.max(0.75, ratio - 0.25)
        : p95 < 13
          ? Math.min(initialPixelRatio, ratio + 0.25)
          : ratio

      if (next === ratio)
        return null
      ratio = next
      return ratio
    },
  }
}
