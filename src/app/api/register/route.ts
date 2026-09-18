/**
 * Creating a pilot.
 *
 * Auth.js owns sessions and has no sign-up flow, so this is the one identity
 * route that stays hand-written. It only creates the row; the browser then
 * signs in through Auth.js like any returning pilot, so there is exactly one
 * code path that mints a session.
 */

import { registerPilot } from 'Ð'
import { createRateLimiter } from 'Ξrate-limit'

import { serverDb } from '../../../lib/server/db'


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUS: Record<string, number> = { taken: 409, malformed: 400, invalid: 401 }

/**
 * Five accounts a minute per IP.
 *
 * One instance at module scope, not one per request: Vercel's Fluid Compute
 * reuses a warm instance across invocations, so this is free lazy state. It is
 * also only as global as ONE instance — a flood spread across many warm
 * instances is undercounted here. The actual floor for that is a WAF rule, not
 * this module; see AGENTS.md / docs/overhaul-report.md §4.3 N3.
 */
const LIMIT   = { capacity: 5, refillPerSecond: 5 / 60 }
const limiter = createRateLimiter(LIMIT)

/** `x-forwarded-for` carries the whole proxy chain; only its first hop is the client. */
function clientIp (request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown'
}

function rateLimited (): Response {
  return Response.json(
    { error: 'rate-limited' },
    { status: 429, headers: { 'Retry-After': String(Math.ceil(1 / LIMIT.refillPerSecond)) }},
  )
}

export async function POST (request: Request): Promise<Response> {
  if (!limiter.take(clientIp(request)))
    return rateLimited()

  let body: unknown
  try {
    body = await request.json()
  }
  catch {
    return Response.json({ error: 'malformed' }, { status: 400 })
  }

  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown }
  const result                 = await registerPilot(
    await serverDb(),
    typeof username === 'string' ? username : '',
    typeof password === 'string' ? password : '',
  )

  if (!result.ok)
    return Response.json({ error: result.reason }, { status: STATUS[result.reason] ?? 400 })

  return Response.json({ pilot: result.pilot }, { status: 201 })
}
