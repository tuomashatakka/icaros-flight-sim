/**
 * Create an account.
 *
 * Identity lives here rather than on the battle server because this is the half
 * of the deployment that sits next to the database: Vercel injects
 * `DATABASE_URL` from the Neon integration, and the game server is a long-lived
 * process somewhere else entirely.
 */

import { register } from '@crash-velocity/data'
import { authResponse, credentialsOf } from 'Δlib/server/auth-response'
import { serverStore } from 'Δlib/server/store'


// `node:crypto`'s scrypt does not exist on the edge runtime, and hashing is the
// whole job here. Explicit rather than relying on the default staying `nodejs`.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST (request: Request): Promise<Response> {
  const credentials = await credentialsOf(request)
  if (!credentials)
    return Response.json({ error: 'malformed' }, { status: 400 })

  return authResponse(await register(await serverStore(), credentials.username, credentials.password))
}
