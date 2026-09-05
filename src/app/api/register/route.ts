/**
 * Creating a pilot.
 *
 * Auth.js owns sessions and has no sign-up flow, so this is the one identity
 * route that stays hand-written. It only creates the row; the browser then
 * signs in through Auth.js like any returning pilot, so there is exactly one
 * code path that mints a session.
 */

import { registerPilot } from '@crash-velocity/data'

import { serverDb } from 'Δlib/server/db'


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const STATUS: Record<string, number> = { taken: 409, malformed: 400, invalid: 401 }

export async function POST (request: Request): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  }
  catch {
    return Response.json({ error: 'malformed' }, { status: 400 })
  }

  const { username, password } = (body ?? {}) as { username?: unknown; password?: unknown }
  const result = await registerPilot(
    await serverDb(),
    typeof username === 'string' ? username : '',
    typeof password === 'string' ? password : '',
  )

  if (!result.ok)
    return Response.json({ error: result.reason }, { status: STATUS[result.reason] ?? 400 })

  return Response.json({ pilot: result.pilot }, { status: 201 })
}
