/**
 * Password hashing that works on both runtimes.
 *
 * This used to be `Bun.password` (argon2id, built in, no dependency). It cannot
 * stay that way: registration and login now run in Next route handlers on
 * Vercel's *Node* runtime, where there is no `Bun`. scrypt is the portable
 * answer that keeps the no-dependency property — it is in `node:crypto`, which
 * Bun implements too, and it is a real memory-hard KDF rather than a fast hash
 * with a salt bolted on.
 *
 * The cost parameters are encoded into each stored hash, so raising them later
 * does not invalidate what is already in the database.
 */

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'


const PREFIX = 'scrypt'

// 128 · N · r = 32 MiB of working memory at these values, ~100 ms per hash.
const N      = 32768
const R      = 8
const P      = 1
const KEYLEN = 32
const SALT   = 16

/**
 * Node's default `maxmem` is exactly 32 MiB and OpenSSL checks it against
 * 128·N·r *plus* per-thread overhead, so the parameters above sit just over the
 * line and throw `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` without this.
 */
const MAXMEM = 64 * 1024 * 1024

// Upper bounds for what may be read back out of a stored hash. A row carrying
// N = 2^30 — corrupt, or written by something hostile — would otherwise ask for
// gigabytes on the next login attempt.
const MAX_N = 1 << 17
const MAX_R = 16
const MAX_P = 4

/**
 * The callback form, not `scryptSync`.
 *
 * This module is loaded by the battle server, which is stepping a 60 Hz
 * simulation in the same process; a synchronous 100 ms hash would drop six
 * ticks. (It runs on the libuv threadpool, four wide by default, so concurrent
 * logins serialise in fours — fine at this scale, worth knowing at any other.)
 */
function derive (password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (error, key) => {
      if (error)
        reject(error)
      else
        resolve(key)
    })
  })
}

/** `scrypt$N$r$p$salt$key`, salt and key base64. */
export async function hashPassword (password: string): Promise<string> {
  const salt = randomBytes(SALT)
  const key  = await derive(password, salt, N, R, P)
  return [ PREFIX, N, R, P, salt.toString('base64'), key.toString('base64') ].join('$')
}

type Parsed = {
  n:        number;
  r:        number;
  p:        number;
  salt:     Buffer;
  expected: Buffer;
}

/**
 * Pull the parameters back out of a stored hash, or `null`.
 *
 * Everything is bounded on the way out. A row carrying N = 2^30 — corrupt, or
 * written by something hostile — would otherwise ask for gigabytes on the next
 * login attempt, and a `null` here is a failed login rather than a 500 on a
 * public endpoint.
 */
function parseStored (stored: string): Parsed | null {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== PREFIX)
    return null

  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])

  const bounded = (value: number, max: number, min = 1) =>
    Number.isInteger(value) && value >= min && value <= max

  // Powers of two only, which is what scrypt's N means.
  if (!bounded(n, MAX_N, 2) || (n & n - 1) !== 0)
    return null
  if (!bounded(r, MAX_R) || !bounded(p, MAX_P))
    return null

  const salt     = Buffer.from(parts[4] as string, 'base64')
  const expected = Buffer.from(parts[5] as string, 'base64')
  if (salt.length === 0 || expected.length === 0)
    return null

  return { n, r, p, salt, expected }
}

export async function verifyPassword (password: string, stored: string): Promise<boolean> {
  // Legacy `Bun.password` hashes. They are argon2id in PHC form, and login runs
  // on Node now, which cannot verify them — so they fail rather than being
  // half-supported on one of the two hosts. Loud, because "wrong name or
  // password" for a password that is correct is otherwise unexplainable.
  if (stored.startsWith('$argon2')) {
    console.warn('[auth] argon2 password hash predates the scrypt migration and cannot be verified; the account must be re-registered')
    return false
  }

  const parsed = parseStored(stored)
  if (!parsed)
    return false

  let derived: Buffer
  try {
    derived = await derive(password, parsed.salt, parsed.n, parsed.r, parsed.p)
  }
  catch {
    return false
  }

  // `timingSafeEqual` throws a RangeError on mismatched lengths, so the guard is
  // required rather than defensive — and a length mismatch is already a "no".
  if (derived.length !== parsed.expected.length)
    return false

  return timingSafeEqual(derived, parsed.expected)
}

let dummy: Promise<string> | null = null

/**
 * A real hash of a value nothing can match, for the constant-time path in
 * `login`: verifying against it makes a missing username cost the same as a
 * wrong password, so response time stops enumerating who is registered.
 *
 * Memoised rather than computed at module scope — a top-level `await` here
 * would make this module a hazard for Next's bundler, and hashing once per
 * process is the point either way.
 */
export function dummyHash (): Promise<string> {
  dummy ??= hashPassword(crypto.randomUUID())
  return dummy
}

// Warmed at import, not awaited: the first failed login should not be the
// request that pays for it. A rejection resets rather than being cached forever.
void dummyHash().catch(() => {
  dummy = null
})
