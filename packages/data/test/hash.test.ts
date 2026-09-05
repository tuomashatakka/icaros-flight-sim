/**
 * Password hashing.
 *
 * The reason this file exists at all is that `verifyPassword` is now the only
 * thing standing between a malformed row and the login route: it has to answer
 * `false` to every kind of garbage rather than throw, because a throw here is a
 * 500 on a public endpoint.
 */
import { describe, expect, it } from 'vitest'
import { dummyHash, hashPassword, verifyPassword } from '../src/auth/hash'


const GOOD = 'correct-horse'

describe('hashPassword', () => {
  it('round-trips', async () => {
    const stored = await hashPassword(GOOD)
    expect(await verifyPassword(GOOD, stored)).toBe(true)
  })

  it('never contains the password', async () => {
    expect(await hashPassword(GOOD)).not.toContain(GOOD)
  })

  it('encodes its parameters, so they can be raised later', async () => {
    const stored = await hashPassword(GOOD)
    expect(stored.split('$').slice(0, 4)).toEqual([ 'scrypt', '32768', '8', '1' ])
  })

  it('salts, so two hashes of one password differ', async () => {
    expect(await hashPassword(GOOD)).not.toBe(await hashPassword(GOOD))
  })
})

describe('verifyPassword', () => {
  it('refuses the wrong password', async () => {
    expect(await verifyPassword('wrong-horse-battery', await hashPassword(GOOD))).toBe(false)
  })

  it('refuses a tampered key', async () => {
    const parts = (await hashPassword(GOOD)).split('$')
    parts[5]    = Buffer.from('not the key at all!!').toString('base64')
    expect(await verifyPassword(GOOD, parts.join('$'))).toBe(false)
  })

  it('returns false rather than throwing on anything malformed', async () => {
    const rubbish = [
      '',
      'scrypt',
      'scrypt$32768$8$1$onlyfivefields',
      'scrypt$32768$8$1$$',
      'scrypt$notanumber$8$1$c2FsdA==$a2V5',
      // Not a power of two, and absurd: a row like this must not turn a login
      // into a multi-gigabyte allocation.
      'scrypt$1073741824$8$1$c2FsdA==$a2V5',
      'scrypt$99$8$1$c2FsdA==$a2V5',
      'bcrypt$2a$10$abcdefghijklmnop',
    ]

    for (const stored of rubbish)
      expect(await verifyPassword(GOOD, stored), stored).toBe(false)
  })

  it('refuses a legacy argon2 hash instead of throwing on Node', async () => {
    // These predate the move off `Bun.password`. Login runs on Vercel's Node
    // runtime now, which has no argon2, so they cannot be verified anywhere it
    // matters — the honest answer is a failed login, not a crash.
    const argon2 = '$argon2id$v=19$m=65536,t=2,p=1$c2FsdHNhbHQ$3aXcXY9uNsPuRWHY0Y2v0w'
    expect(await verifyPassword(GOOD, argon2)).toBe(false)
  })
})

describe('dummyHash', () => {
  it('is computed once, so a failed login is not a hashing cost per request', async () => {
    expect(await dummyHash()).toBe(await dummyHash())
  })

  it('is a real hash that nothing verifies against', async () => {
    const stored = await dummyHash()
    expect(stored.startsWith('scrypt$')).toBe(true)
    expect(await verifyPassword(GOOD, stored)).toBe(false)
  })
})
