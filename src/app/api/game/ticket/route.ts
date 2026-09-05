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
 */

import { mintTicket } from '@crash-velocity/data'

import { auth } from 'Δlib/auth'


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET (request: Request): Promise<Response> {
  const session = await auth()
  const asked   = new URL(request.url).searchParams.get('name')?.slice(0, 24)

  // A signed-in pilot's name is the server's to decide, not the query
  // string's; only a guest gets to pick one.
  const pilotId = session?.user?.id ?? null
  const name    = pilotId ? session?.user?.name ?? 'Pilot' : asked || 'Pilot'

  return Response.json({ ticket: await mintTicket({ pilotId, name }), name, registered: Boolean(pilotId) })
}
