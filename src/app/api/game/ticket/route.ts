/**
 * A ticket for the game server.
 *
 * The game server is a different origin, so Auth.js's httpOnly cookie never
 * reaches it — and the previous arrangement's answer, a week-long bearer token
 * in `localStorage`, is exactly what an httpOnly cookie exists to prevent.
 *
 * So the browser asks here, where the session *is* readable, and gets sixty
 * seconds' worth of signed claim to hand to Colyseus's `onAuth`. A signed-out
 * visitor still gets one: guests are first class, and a ticket that says
 * "guest" is simpler for the server than a ticket that might be absent.
 *
 * Both secrets this route depends on are new, which means the first deployment
 * after the netcode refactor had neither — and the route answered with a bare
 * 500 and an empty body, twice, for two unrelated reasons. Neither failure is
 * worth breaking guest play over, and neither is worth being unreadable:
 *
 * - A broken `AUTH_SECRET` means nobody can be identified. That is a reason to
 *   seat a guest, not a reason to refuse everyone — so the session lookup
 *   degrades rather than throwing.
 * - A missing `GAME_TOKEN_SECRET` genuinely cannot be worked around: an
 *   unsigned ticket is not a ticket. But it is a configuration fault, so it
 *   answers 503 and names the variable rather than 500-ing anonymously.
 */

import { mintTicket, sanitisePilotName } from 'Ð'
import { createRateLimiter } from 'Ξrate-limit'

import { auth } from '../../../../lib/auth'

import type { Session } from 'next-auth'


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Thirty tickets a minute per IP — a browser mints one on every load of the
 * lobby and every level, not just at sign-in, so this budget is generous
 * compared to registration's.
 *
 * One instance at module scope: see the identical note in
 * `src/app/api/register/route.ts` for why, and for what it does not cover.
 */
const LIMIT   = { capacity: 30, refillPerSecond: 30 / 60 }
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

/**
 * Read the session, or decide there isn't one.
 *
 * Auth.js throws `MissingSecret` when `AUTH_SECRET` is unset, and a handful of
 * other things when a cookie is malformed. Every one of them means the same
 * thing here: we do not know who this is.
 */
async function currentSession (): Promise<Session | null> {
  try {
    return await auth()
  }
  catch (error) {
    console.warn('[ticket] no session:', error instanceof Error ? error.message : error)
    return null
  }
}

export async function GET (request: Request): Promise<Response> {
  if (!limiter.take(clientIp(request)))
    return rateLimited()

  const session = await currentSession()
  const asked   = sanitisePilotName(new URL(request.url).searchParams.get('name'))

  // A signed-in pilot's name is the server's to decide, not the query
  // string's; only a guest gets to pick one.
  const pilotId = session?.user?.id ?? null
  const name    = pilotId ? session?.user?.name ?? 'Pilot' : asked

  try {
    return Response.json({ ticket: await mintTicket({ pilotId, name }), name, registered: Boolean(pilotId) })
  }
  catch (error) {
    console.error('[ticket] cannot mint:', error instanceof Error ? error.message : error)
    return Response.json(
      { error: 'ticket-unavailable', detail: 'GAME_TOKEN_SECRET is not set on this deployment' },
      { status: 503 },
    )
  }
}
