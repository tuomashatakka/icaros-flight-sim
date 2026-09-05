/**
 * Short-lived join tickets.
 *
 * The game server is a different origin from the Next app, so Auth.js's
 * httpOnly session cookie never reaches it — and handing the browser a
 * long-lived bearer token to keep in localStorage is the thing that arrangement
 * was supposed to stop. Instead the Next app, which *can* read the session,
 * mints a ticket that is worth sixty seconds and one room join.
 *
 * Both halves import this module, so the claim set cannot drift the way a
 * hand-typed mirror of a server's format does.
 */

import { SignJWT, jwtVerify } from 'jose'


export type Ticket = {
  pilotId: string | null;
  name:    string;
}

export const TICKET_TTL_SECONDS = 60

const ISSUER   = 'crash-velocity/next'
const AUDIENCE = 'crash-velocity/game'

function keyOf (secret?: string): Uint8Array {
  const value = secret ?? process.env.GAME_TOKEN_SECRET
  if (!value)
    throw new Error('GAME_TOKEN_SECRET is not set; the Next app and the game server must share it')
  return new TextEncoder().encode(value)
}

export async function mintTicket (ticket: Ticket, secret?: string): Promise<string> {
  return await new SignJWT({ name: ticket.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(ticket.pilotId ?? 'guest')
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TICKET_TTL_SECONDS}s`)
    .sign(keyOf(secret))
}

/**
 * Returns null rather than throwing: an expired or forged ticket is an ordinary
 * thing for a public socket to receive, and the caller's answer is the same as
 * for no ticket at all — seat them as a guest.
 */
export async function verifyTicket (token: string, secret?: string): Promise<Ticket | null> {
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), { issuer: ISSUER, audience: AUDIENCE })
    const name        = typeof payload.name === 'string' ? payload.name : 'Pilot'
    return { pilotId: payload.sub && payload.sub !== 'guest' ? payload.sub : null, name }
  }
  catch {
    return null
  }
}
