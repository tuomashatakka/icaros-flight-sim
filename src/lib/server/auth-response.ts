/**
 * Shared shapes for the auth routes.
 *
 * The bodies are exactly what `src/lib/net/account.ts` already parsed off the
 * battle server before these moved to Next — `{ token, account }` on success,
 * `{ error: reason }` with 409 / 401 / 400 otherwise — so the browser side did
 * not have to learn anything new.
 */

import type { AuthResult } from '@crash-velocity/data'


export type Credentials = { username: string; password: string }

/** Whatever arrived, before it has been shown to be credentials. */
type RawBody = {
  username?: unknown;
  password?: unknown;
}

/** `null` when the body is not JSON with two string fields. */
export async function credentialsOf (request: Request): Promise<Credentials | null> {
  let body: RawBody
  try {
    body = await request.json() as RawBody
  }
  catch {
    return null
  }

  if (typeof body.username !== 'string' || typeof body.password !== 'string')
    return null

  return { username: body.username, password: body.password }
}

export function authResponse (result: AuthResult): Response {
  if (result.ok)
    return Response.json({ token: result.token, account: result.account })

  // `taken` is the only one that is not a refusal to identify someone.
  return Response.json({ error: result.reason }, { status: result.reason === 'taken' ? 409 : 401 })
}

/** `Authorization: Bearer <token>`, or null. */
export function bearerToken (request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header?.toLowerCase().startsWith('bearer '))
    return null

  return header.slice('bearer '.length).trim() || null
}
