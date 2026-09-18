/**
 * The token bucket every rate-limited entry point shares.
 *
 * Every case is driven by an injected clock rather than a real one: a
 * rate-limit test that occasionally denies (or allows) a request a few
 * milliseconds either side of a boundary is worse than no test at all.
 */
import { describe, expect, it } from 'vitest'
import { MAX_RATE_LIMIT_KEYS, createRateLimiter } from 'Ξrate-limit'


describe('createRateLimiter', () => {
  it('allows a burst up to capacity, then denies', () => {
    const now     = 0
    const limiter = createRateLimiter({ capacity: 3, refillPerSecond: 1, now: () => now })

    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(false)
  })

  it('refills over time rather than staying empty forever', () => {
    let now = 0
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 1, now: () => now })

    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(false)

    now += 1_000 // one second of wall time buys back exactly one token
    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(false)
  })

  it('never holds more than capacity, no matter how long it waits', () => {
    let now = 0
    const limiter = createRateLimiter({ capacity: 2, refillPerSecond: 1, now: () => now })

    now += 1_000_000
    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(false)
  })

  it('keeps every key on its own bucket', () => {
    const now     = 0
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 1, now: () => now })

    expect(limiter.take('a')).toBe(true)
    expect(limiter.take('a')).toBe(false)
    // 'b' has never been touched — 'a' being spent must not cost it anything.
    expect(limiter.take('b')).toBe(true)
  })

  it('reports how many keys it is tracking', () => {
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 1, now: () => 0 })
    expect(limiter.size()).toBe(0)

    limiter.take('a')
    limiter.take('b')
    limiter.take('a') // already tracked — must not double-count
    expect(limiter.size()).toBe(2)
  })

  it('evicts the oldest key once the map is over its cap, rather than growing forever', () => {
    const now     = 0
    const limiter = createRateLimiter({ capacity: 1, refillPerSecond: 0, now: () => now })

    // Drain key-0's only token, so a later `take()` on it can only succeed if
    // its bucket was forgotten entirely — never because it still had one.
    expect(limiter.take('key-0')).toBe(true)
    expect(limiter.take('key-0')).toBe(false)

    for (let i = 1; i <= MAX_RATE_LIMIT_KEYS; i++)
      limiter.take(`key-${i}`)

    expect(limiter.size()).toBe(MAX_RATE_LIMIT_KEYS)
    // Forgotten, not merely still empty: a fresh bucket starts full again.
    expect(limiter.take('key-0')).toBe(true)
  })
})
