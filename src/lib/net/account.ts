/**
 * Identity, from the browser.
 *
 * Auth.js owns sign-in, sign-out and the session; this is the thin layer around
 * it — registration, which Auth.js does not do, and the error strings a player
 * should actually read.
 *
 * There is no token here any more. The previous version kept a week-long bearer
 * in `localStorage`, because the lobby WebSocket sent it to a different origin
 * and so JavaScript had to be able to read it. That is exactly what an httpOnly
 * cookie exists to prevent, and the replacement is `/api/game/ticket`: sixty
 * seconds, signed, minted per join by the half of the app that CAN read the
 * session. See `src/engine/net/ticket.ts`.
 *
 * Guests remain first class. Nothing here is required to play; signing in only
 * buys a remembered name and a record.
 */

import { signIn, signOut } from 'next-auth/react'


export type AuthOutcome = { ok: true } | { ok: false; error: string }

const MESSAGES: Record<string, string> = {
  taken:     'that name is taken',
  invalid:   'wrong name or password',
  malformed: 'names are 3–24 letters, digits, dash or underscore; passwords at least 8 characters',
}

function describe (reason: string | undefined, status: number): string {
  return MESSAGES[reason ?? ''] ?? `sign-in failed (${status})`
}

/**
 * Create a pilot, then sign them in.
 *
 * Two steps rather than one because Auth.js has no sign-up flow — but the sign
 * -in half goes through it like any returning pilot, so there is exactly one
 * code path that mints a session.
 */
export async function register (username: string, password: string): Promise<AuthOutcome> {
  let response: Response
  try {
    response = await fetch('/api/register', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    })
  }
  catch {
    return { ok: false, error: 'could not reach the server' }
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    return { ok: false, error: describe(body.error, response.status) }
  }

  return await login(username, password)
}

export async function login (username: string, password: string): Promise<AuthOutcome> {
  const result = await signIn('credentials', { username, password, redirect: false })

  // Auth.js reports a rejected credential as an error string rather than a
  // throw, and deliberately does not say WHICH half was wrong.
  return result?.error ? { ok: false, error: MESSAGES.invalid } : { ok: true }
}

export async function logout (): Promise<void> {
  await signOut({ redirect: false })
}

/**
 * A display name for a guest, remembered between visits.
 *
 * The one thing still in `localStorage`, and it is not a credential: a signed
 * -in pilot's name comes from their session, and the ticket route refuses to
 * let a query string rename them.
 */
const GUEST_NAME = 'crash-velocity.guest-name'

export function guestName (): string {
  try {
    return localStorage.getItem(GUEST_NAME) ?? ''
  }
  catch {
    return ''
  }
}

export function rememberGuestName (name: string): void {
  try {
    localStorage.setItem(GUEST_NAME, name)
  }
  catch {
    // private windows throw; a forgotten name is not worth an error
  }
}
