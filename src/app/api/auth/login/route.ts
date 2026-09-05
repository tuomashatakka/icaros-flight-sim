/**
 * Sign in to an existing account.
 *
 * A wrong password and a name nobody has registered take the same time and
 * return the same body — see the dummy-hash comment in `auth/accounts.ts`.
 */

import { login } from '@crash-velocity/data'
import { authResponse, credentialsOf } from 'Δlib/server/auth-response'
import { serverStore } from 'Δlib/server/store'


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST (request: Request): Promise<Response> {
  const credentials = await credentialsOf(request)
  if (!credentials)
    return Response.json({ error: 'malformed' }, { status: 400 })

  return authResponse(await login(await serverStore(), credentials.username, credentials.password))
}
