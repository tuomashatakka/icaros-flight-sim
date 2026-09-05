/**
 * Registration and the game ticket, as plain `Request` → `Response`.
 *
 * These are the only two identity routes left that are ours: Auth.js owns
 * sign-in, sign-out and the session, and there is nothing useful to assert
 * about a library's own handlers. What IS ours is that sign-up refuses a
 * duplicate name, and that a ticket the game server will accept comes back
 * signed — including for a signed-out visitor, because guests are first class.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'

import { verifyTicket } from '@crash-velocity/data'

const SECRET = 'test-game-secret'
const GOOD   = 'correct-horse'

// The ticket route reads the Auth.js session. Stubbing `auth()` rather than
// standing up a whole sign-in keeps this a test of the ROUTE, not of Auth.js.
let session: { user?: { id?: string; name?: string } } | null = null

/** When set, `auth()` throws it — the shape of a missing `AUTH_SECRET`. */
let sessionFailure: Error | null = null

vi.mock('Δlib/auth', () => ({
  auth: async () => {
    if (sessionFailure)
      throw sessionFailure
    return session
  },
}))

const post = (body: unknown) =>
  new Request('http://localhost/api/register', { method: 'POST', body: JSON.stringify(body) })

const uniqueName = () => `Pilot_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`

beforeAll(() => {
  // Read on first call rather than at import, which is what lets a test choose
  // the driver without stubbing the module.
  process.env.DB_DRIVER = 'pglite'
  process.env.GAME_TOKEN_SECRET = SECRET
})

describe('POST /api/register', () => {

  it('creates a pilot', async () => {
    const { POST } = await import('Δapp/api/register/route')
    const { migratePglite } = await import('@crash-velocity/data/migrate')
    const { serverDb } = await import('Δlib/server/db')
    await migratePglite(await serverDb())

    const name     = uniqueName()
    const response = await POST(post({ username: name, password: GOOD }))
    expect(response.status).toBe(201)

    const body = await response.json() as { pilot: { username: string } }
    expect(body.pilot.username).toBe(name)
  }, 60_000)

  it('refuses a duplicate name with 409, and a bad one with 400', async () => {
    const { POST } = await import('Δapp/api/register/route')
    const name = uniqueName()

    expect((await POST(post({ username: name, password: GOOD }))).status).toBe(201)
    expect((await POST(post({ username: name, password: GOOD }))).status).toBe(409)
    expect((await POST(post({ username: 'x', password: 'short' }))).status).toBe(400)
  }, 60_000)

  it('does not answer a body that is not JSON', async () => {
    const { POST } = await import('Δapp/api/register/route')
    const bad = new Request('http://localhost/api/register', { method: 'POST', body: 'not json' })
    expect((await POST(bad)).status).toBe(400)
  })
})

describe('GET /api/game/ticket', () => {

  it('signs a ticket the game server will accept', async () => {
    session = { user: { id: 'pilot-1', name: 'Maverick' } }

    const { GET }  = await import('Δapp/api/game/ticket/route')
    const response = await GET(new Request('http://localhost/api/game/ticket'))
    const body     = await response.json() as { ticket: string; registered: boolean }

    expect(body.registered).toBe(true)
    expect(await verifyTicket(body.ticket, SECRET)).toEqual({ pilotId: 'pilot-1', name: 'Maverick' })
  })

  it('gives a signed-out visitor a guest ticket rather than nothing', async () => {
    session = null

    const { GET }  = await import('Δapp/api/game/ticket/route')
    const response = await GET(new Request('http://localhost/api/game/ticket?name=Ghost'))
    const body     = await response.json() as { ticket: string; registered: boolean }

    expect(body.registered).toBe(false)
    expect(await verifyTicket(body.ticket, SECRET)).toEqual({ pilotId: null, name: 'Ghost' })
  })

  it('will not let a query string rename a signed-in pilot', async () => {
    session = { user: { id: 'pilot-1', name: 'Maverick' } }

    const { GET } = await import('Δapp/api/game/ticket/route')
    const body    = await (await GET(new Request('http://localhost/api/game/ticket?name=Impostor'))).json() as { ticket: string }

    expect((await verifyTicket(body.ticket, SECRET))?.name).toBe('Maverick')
  })

  it('refuses a forged ticket', async () => {
    expect(await verifyTicket('not.a.jwt', SECRET)).toBeNull()
  })

  it('still seats a guest when the session cannot be read at all', async () => {
    // The shape of a deployment with no AUTH_SECRET. Nobody can be identified,
    // which is a reason to seat a guest — not a reason to refuse everyone.
    // This route answered 500 with an empty body on the first deploy after the
    // netcode refactor, for exactly this.
    sessionFailure = new Error('MissingSecret: Please define a `secret`.')

    const { GET }  = await import('Δapp/api/game/ticket/route')
    const response = await GET(new Request('http://localhost/api/game/ticket?name=Ghost'))
    expect(response.status).toBe(200)

    const body = await response.json() as { ticket: string; registered: boolean }
    expect(body.registered).toBe(false)
    expect(await verifyTicket(body.ticket, SECRET)).toEqual({ pilotId: null, name: 'Ghost' })

    sessionFailure = null
  })

  it('answers 503 and names the variable when it cannot sign at all', async () => {
    // An unsigned ticket is not a ticket, so this one genuinely cannot be
    // worked around — but it is a configuration fault, and an anonymous 500
    // tells an operator nothing.
    session = null
    const previous = process.env.GAME_TOKEN_SECRET
    delete process.env.GAME_TOKEN_SECRET

    try {
      const { GET }  = await import('Δapp/api/game/ticket/route')
      const response = await GET(new Request('http://localhost/api/game/ticket'))
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ error: 'ticket-unavailable' })
    }
    finally {
      process.env.GAME_TOKEN_SECRET = previous
    }
  })
})
