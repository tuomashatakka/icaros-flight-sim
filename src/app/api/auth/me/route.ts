/**
 * Who a token belongs to.
 *
 * The lobby socket answers this too, in its `welcome` message — but only once
 * it has connected, and only by falling back to a guest when the token has
 * expired. This is how the page can tell "signed in" from "the stored token is
 * a week old" before any of that happens.
 */

import { bearerToken } from 'Δlib/server/auth-response'
import { serverStore } from 'Δlib/server/store'


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET (request: Request): Promise<Response> {
  const token = bearerToken(request)
  if (!token)
    return Response.json({ error: 'invalid' }, { status: 401 })

  const store   = await serverStore()
  const account = await store.resolveSession(token)
  if (!account)
    return Response.json({ error: 'invalid' }, { status: 401 })

  return Response.json({ account, stats: await store.statsFor(account.id) })
}
