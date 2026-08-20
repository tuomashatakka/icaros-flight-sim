import { DEFAULT_TUNING } from '../state'
import type { ShipTuning } from '../state'
import type { OverlayFlags } from './types'


/**
 * Dev-only URL overrides.
 *
 * The payoff is reproduction: with these, any bug is a shareable link that
 * restores the exact seed, tuning and overlay set that produced it, instead of
 * a paragraph describing which sliders to drag. Nothing here is read in
 * production — the harness that consumes it is behind the same NODE_ENV gate.
 *
 * Supported:
 *   ?seed=7                    override the scene seed
 *   ?paused=1                  boot with the sim frozen (deterministic shots)
 *   ?tuning=<base64 json>      apply a partial ShipTuning before the first tick
 *   ?overlay=colliders,wheels  enable debug overlays on boot
 *   ?nohud=1                   hide the canvas HUD (clean screenshots)
 *   ?scenario=<name>           run a bundled scenario on boot
 */
export type DevParams = {
  seed:     number | null;
  paused:   boolean;
  tuning:   Partial<ShipTuning> | null;
  overlay:  OverlayFlags;
  nohud:    boolean;
  scenario: string | null;
}

const EMPTY: DevParams = {
  seed:     null,
  paused:   false,
  tuning:   null,
  overlay:  {},
  nohud:    false,
  scenario: null,
}

const OVERLAY_KEYS = [ 'colliders', 'wheels', 'contacts', 'path', 'frustum' ] as const

/**
 * Parse a partial tuning object out of a base64 blob.
 *
 * Unknown keys are dropped and non-finite values rejected rather than passed
 * through — the tuning store's own `merge` guard exists because an `undefined`
 * reaching the sim produces NaN forces silently, and a URL is an even easier
 * way to send garbage than stale localStorage.
 */
function parseTuning (raw: string): Partial<ShipTuning> | null {
  try {
    const decoded                  = JSON.parse(atob(raw)) as Record<string, unknown>
    const out: Partial<ShipTuning> = {}
    for (const key of Object.keys(DEFAULT_TUNING) as Array<keyof ShipTuning>) {
      const value = decoded[key]
      if (typeof value === 'number' && Number.isFinite(value))
        out[key] = value
    }
    return Object.keys(out).length > 0 ? out : null
  }
  catch {
    console.warn('[dev] ignoring malformed ?tuning=')
    return null
  }
}

export function readDevParams (search = typeof window === 'undefined' ? '' : window.location.search): DevParams {
  if (!search)
    return EMPTY

  const query = new URLSearchParams(search)
  const seed  = Number(query.get('seed'))

  const overlay: OverlayFlags = {}
  const requested             = (query.get('overlay') ?? '').split(',')
    .map(s => s.trim())
  for (const key of OVERLAY_KEYS)
    if (requested.includes(key))
      overlay[key] = true

  const tuning = query.get('tuning')

  return {
    seed:     query.has('seed') && Number.isFinite(seed) ? seed : null,
    paused:   query.get('paused') === '1',
    tuning:   tuning ? parseTuning(tuning) : null,
    overlay,
    nohud:    query.get('nohud') === '1',
    scenario: query.get('scenario'),
  }
}
