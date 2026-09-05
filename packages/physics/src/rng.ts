/**
 * The one seeded generator every simulation draws from.
 *
 * mulberry32: 32-bit state, one multiply-xorshift per draw, identical output
 * on every JS engine because it never leaves integer arithmetic. Anything
 * inside a tick that needs randomness takes a stream from here — never
 * `Math.random`, which would desync client prediction from the server.
 */
export function mulberry32 (seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = a + 0x6d2b79f5 | 0

    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}
