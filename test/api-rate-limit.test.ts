/**
 * The token bucket in front of `/api/register` and `/api/game/ticket`.
 *
 * Both routes gate on the limiter before doing anything else — before even
 * parsing the body — so every case here can use a deliberately malformed
 * request and read the status code alone: a 429 means the gate fired, and
 * anything else means it didn't. That also keeps this file independent of the
 * database `test/api-auth.test.ts` needs for a real registration.
 *
 * Every case picks its own `x-forwarded-for` value so the requests below never
 * share a bucket with another case in this file.
 */
import { describe, expect, it, vi } from 'vitest'

// Always a guest: a real `auth()` call needs a working database, and the
// thing under test here is the limiter in front of the route, not Auth.js.
vi.mock('Δlib/auth', () => ({ auth: async () => null }))

let ipSeq = 0

/** A fresh IP for each case, so one test's exhausted bucket never leaks into another's. */
const freshIp = () => `203.0.113.${++ipSeq}`

const registerRequest = (ip: string) =>
  new Request('http://localhost/api/register', {
    method:  'POST',
    // Malformed on purpose: the limiter must gate before the body is even
    // read, so every allowed call still answers fast with a 400.
    body:    'not json',
    headers: { 'x-forwarded-for': ip },
  })

const ticketRequest = (ip: string) =>
  new Request('http://localhost/api/game/ticket', { headers: { 'x-forwarded-for': ip }})

describe('POST /api/register rate limiting', () => {
  it('allows five requests a minute per IP, then answers 429', async () => {
    const { POST } = await import('Δapp/api/register/route')
    const ip       = freshIp()

    for (let i = 0; i < 5; i++)
      expect((await POST(registerRequest(ip))).status).toBe(400)

    const limited = await POST(registerRequest(ip))
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(await limited.json()).toMatchObject({ error: expect.any(String) })
  })

  it('gives a different IP its own budget', async () => {
    const { POST } = await import('Δapp/api/register/route')
    expect((await POST(registerRequest(freshIp()))).status).toBe(400)
  })

  it('falls back to one shared bucket when no IP header is present at all', async () => {
    const { POST } = await import('Δapp/api/register/route')
    const bare     = () => new Request('http://localhost/api/register', { method: 'POST', body: 'not json' })

    // This is the only case in the file that omits every IP header, so
    // 'unknown' starts this test with a full bucket of its own.
    for (let i = 0; i < 5; i++)
      expect((await POST(bare())).status).toBe(400)

    expect((await POST(bare())).status).toBe(429)
  })
})

describe('GET /api/game/ticket rate limiting', () => {
  it('allows thirty requests a minute per IP, then answers 429', async () => {
    const { GET } = await import('Δapp/api/game/ticket/route')
    const ip      = freshIp()

    for (let i = 0; i < 30; i++)
      expect((await GET(ticketRequest(ip))).status).not.toBe(429)

    const limited = await GET(ticketRequest(ip))
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(await limited.json()).toMatchObject({ error: expect.any(String) })
  })

  it('gives a different IP its own budget', async () => {
    const { GET } = await import('Δapp/api/game/ticket/route')
    expect((await GET(ticketRequest(freshIp()))).status).not.toBe(429)
  })
})
