/**
 * Account access from the browser.
 *
 * The game server owns identity, not Next — it is the process that holds the
 * database. So these are plain fetches to the server's HTTP side, and the token
 * lives in `localStorage` because a hobby game does not need a cookie session
 * spanning two origins.
 *
 * Guests are first class throughout. Nothing here is required to play; signing
 * in only buys a remembered name and a record.
 */

import { resolveServerUrl } from 'Δengine/battle/transport'


const TOKEN_KEY = 'crash-velocity.token'
const NAME_KEY  = 'crash-velocity.name'

export type AccountSummary = {
  id:        string;
  username:  string;
  createdAt: number;
}

export type AuthOutcome =
  | { ok: true; account: AccountSummary; token: string } |
  { ok: false; error: string }

/** The server's HTTP origin, derived from the same setting the socket uses. */
function httpBase (override?: string): string {
  return resolveServerUrl(override).replace(/^ws/, 'http')
}

function describe (reason: string | undefined, status: number): string {
  switch (reason) {
    case 'taken':
      return 'that name is taken'
    case 'invalid':
      return 'wrong name or password'
    case 'malformed':
      return 'names are 3–24 letters, digits, dash or underscore; passwords at least 8 characters'
    default:
      return `sign-in failed (${status})`
  }
}

async function submit (path: string, username: string, password: string, override?: string): Promise<AuthOutcome> {
  let response: Response
  try {
    response = await fetch(`${httpBase(override)}${path}`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    })
  }
  catch {
    // The server is a separate process and may simply not be running, which is
    // a routine state in development rather than an error worth a stack trace.
    return { ok: false, error: 'cannot reach the game server' }
  }

  const body = await response.json().catch(() => ({})) as { token?: string; account?: AccountSummary; error?: string }

  if (!response.ok || !body.token || !body.account)
    return { ok: false, error: describe(body.error, response.status) }

  storeToken(body.token)
  storeName(body.account.username)
  return { ok: true, account: body.account, token: body.token }
}

export const register = (username: string, password: string, server?: string) =>
  submit('/api/auth/register', username, password, server)

export const login = (username: string, password: string, server?: string) =>
  submit('/api/auth/login', username, password, server)

/**
 * Storage access is wrapped because it throws outright in some contexts — a
 * private window with site data blocked, for one — and a missing token has to
 * degrade to guest play rather than crash the page.
 */
export function storedToken (): string | null {
  try {
    return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null
  }
  catch {
    return null
  }
}

export function storedName (): string | null {
  try {
    return globalThis.localStorage?.getItem(NAME_KEY) ?? null
  }
  catch {
    return null
  }
}

export function storeToken (token: string): void {
  try {
    globalThis.localStorage?.setItem(TOKEN_KEY, token)
  }
  catch { /* nothing to do; the player stays a guest for this session */ }
}

export function storeName (name: string): void {
  try {
    globalThis.localStorage?.setItem(NAME_KEY, name)
  }
  catch { /* as above */ }
}

export function signOut (): void {
  try {
    globalThis.localStorage?.removeItem(TOKEN_KEY)
  }
  catch { /* as above */ }
}
