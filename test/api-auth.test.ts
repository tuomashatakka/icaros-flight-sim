/**
 * The auth route handlers.
 *
 * These moved out of the battle server and into Next when the database became
 * Neon: Vercel is the half that sits next to it. Driven as plain `Request` ->
 * `Response`, which is all a route handler is, against `MemoryStore`.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { POST as loginRoute } from 'Δapp/api/auth/login/route'
import { POST as logoutRoute } from 'Δapp/api/auth/logout/route'
import { GET as meRoute } from 'Δapp/api/auth/me/route'
import { POST as registerRoute } from 'Δapp/api/auth/register/route'


const GOOD = 'correct-horse'

const post = (body: unknown) =>
  new Request('http://localhost/api/auth', { method: 'POST', body: JSON.stringify(body) })

const bearer = (token: string, method = 'GET') =>
  new Request('http://localhost/api/auth', { method, headers: { authorization: `Bearer ${token}` }})

/** Fresh per case: the handlers share one process-wide store. */
const uniqueName = () => `Pilot_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`

type AuthBody = { token?: string; account?: { username: string }; error?: string }

beforeAll(() => {
  // `serverStore()` reads this on first call rather than at import, which is
  // what lets a test choose the driver without stubbing the module.
  process.env.STORE_DRIVER = 'memory'
})

describe('POST /api/auth/register', () => {
  it('creates an account and signs it in', async () => {
    const username = uniqueName()
    const response = await registerRoute(post({ username, password: GOOD }))
    const body     = await response.json() as AuthBody

    expect(response.status).toBe(200)
    expect(body.account?.username).toBe(username)
    expect(typeof body.token).toBe('string')
  })

  it('answers 409 for a name that is taken', async () => {
    const username = uniqueName()
    await registerRoute(post({ username, password: GOOD }))

    const response = await registerRoute(post({ username: username.toUpperCase(), password: GOOD }))
    expect(response.status).toBe(409)
    expect((await response.json() as AuthBody).error).toBe('taken')
  })

  it('answers 401 malformed for a name the game would not render', async () => {
    const response = await registerRoute(post({ username: 'has space', password: GOOD }))
    expect((await response.json() as AuthBody).error).toBe('malformed')
  })

  it('answers 400 for a body that is not credentials', async () => {
    expect((await registerRoute(post({ username: 7 }))).status).toBe(400)
  })
})

describe('POST /api/auth/login', () => {
  it('signs in with the right password', async () => {
    const username = uniqueName()
    await registerRoute(post({ username, password: GOOD }))

    const response = await loginRoute(post({ username, password: GOOD }))
    expect(response.status).toBe(200)
    expect((await response.json() as AuthBody).account?.username).toBe(username)
  })

  it('answers the same way to a wrong password and a name nobody has', async () => {
    const username = uniqueName()
    await registerRoute(post({ username, password: GOOD }))

    const wrong   = await loginRoute(post({ username, password: 'wrong-horse-battery' }))
    const missing = await loginRoute(post({ username: uniqueName(), password: GOOD }))

    expect(wrong.status).toBe(401)
    expect(missing.status).toBe(401)
    expect(await wrong.json()).toEqual(await missing.json())
  })
})

describe('GET /api/auth/me and POST /api/auth/logout', () => {
  it('round-trips a session and then forgets it', async () => {
    const username = uniqueName()
    const token    = ((await (await registerRoute(post({ username, password: GOOD }))).json()) as AuthBody).token as string

    const before = await meRoute(bearer(token))
    expect(before.status).toBe(200)
    expect((await before.json() as { account: { username: string } }).account.username).toBe(username)

    expect((await logoutRoute(bearer(token, 'POST'))).status).toBe(204)
    expect((await meRoute(bearer(token))).status).toBe(401)
  })

  it('refuses a request with no bearer token', async () => {
    const response = await meRoute(new Request('http://localhost/api/auth/me'))
    expect(response.status).toBe(401)
  })

  it('accepts a sign-out with no token, so the client can always call it', async () => {
    expect((await logoutRoute(new Request('http://localhost/api/auth/logout', { method: 'POST' }))).status).toBe(204)
  })
})
