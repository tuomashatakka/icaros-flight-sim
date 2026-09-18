/**
 * A pure token bucket, keyed by string.
 *
 * Every caller — `/api/register`, `/api/game/ticket`, and (where the IP is
 * reachable) a room's `onAuth` — wants the same question answered: "has this
 * key done too much, too recently?" Refill is computed lazily, on the `take()`
 * that needs it, from the wall time elapsed since the bucket was last touched
 * — there is no timer of any kind in here, so nothing to leak across a warm
 * Vercel Fluid Compute instance's lifetime or a long-lived game-server process.
 *
 * Best-effort, not a global limit: each instance keeps its own map, so a flood
 * spread across many warm instances is undercounted here. The floor under an
 * attacker who can reach many instances is a WAF rule, not this module — see
 * AGENTS.md / docs/overhaul-report.md §4.3 N3.
 */

export type RateLimiter = {

  /** True and consumes a token if `key` has one to spend; false otherwise. */
  take: (key: string) => boolean;

  /** Keys currently tracked. For tests and callers curious about memory. */
  size: () => number;
}

export type RateLimiterOptions = {

  /** Tokens a key can hold, and so the size of the burst it can spend at once. */
  capacity: number;

  /** Tokens restored per second of wall time. */
  refillPerSecond: number;
  now?:            () => number;
}

type Bucket = {
  tokens:    number;
  touchedAt: number;
}

// A flood of distinct keys — mostly forged IPs — must not grow this map
// forever. This bounds memory rather than accuracy under that load: the least
// recently touched key is forgotten, which is the one least likely to still
// be mid-burst.
export const MAX_RATE_LIMIT_KEYS = 10_000

export function createRateLimiter (options: RateLimiterOptions): RateLimiter {
  const { capacity, refillPerSecond, now = () => Date.now() } = options
  const buckets                                               = new Map<string, Bucket>()

  return {
    take (key) {
      const at       = now()
      const existing = buckets.get(key)

      // Refilled lazily: a bucket nobody has touched costs nothing while idle,
      // and there is no interval anywhere pretending otherwise.
      const elapsedSec = existing ? Math.max(0, (at - existing.touchedAt) / 1000) : 0
      const tokens     = existing ? Math.min(capacity, existing.tokens + elapsedSec * refillPerSecond) : capacity
      const allowed    = tokens >= 1

      // Deleting before re-setting moves the key to the end of the map's
      // iteration order, which is what makes eviction below cheap: the FIRST
      // key in the map is always the one touched longest ago.
      buckets.delete(key)
      buckets.set(key, { tokens: allowed ? tokens - 1 : tokens, touchedAt: at })

      if (buckets.size > MAX_RATE_LIMIT_KEYS) {
        const oldest = buckets.keys().next().value
        if (oldest !== undefined)
          buckets.delete(oldest)
      }

      return allowed
    },

    size: () => buckets.size,
  }
}
