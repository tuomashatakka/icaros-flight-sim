/**
 * Drop a session.
 *
 * Signing out used to be a `localStorage.removeItem` and nothing else, which
 * left the row alive for its full week. It answers 204 whether or not the token
 * resolved: telling a caller that the token they are throwing away was already
 * invalid is not useful, and it would be an oracle.
 */

import { bearerToken } from 'Δlib/server/auth-response'
import { serverStore } from 'Δlib/server/store'


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST (request: Request): Promise<Response> {
  const token = bearerToken(request)
  if (token)
    await (await serverStore()).dropSession(token)

  return new Response(null, { status: 204 })
}
