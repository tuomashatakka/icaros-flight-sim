/**
 * Account access from the browser.
 *
 * Next owns identity now, not the game server: these are same-origin fetches to
 * route handlers that sit next to the Neon database. The game server is a
 * long-lived process on another host, and all it does with identity is read a
 * token to decide whether a lobby connection is a pilot or a guest.
 *
 * The token stays in `localStorage` rather than an httpOnly cookie, even though
 * these are same-origin now. The lobby WebSocket sends it in a message body to
 * a *different* origin, so JavaScript has to be able to read it — a cookie the
 * page cannot see would just mean signing in twice.
 *
 * Guests are first class throughout. Nothing here is required to play; signing
 * in only buys a remembered name and a record.
 */

const TOKEN_KEY = 'crash-velocity.token'
const NAME_KEY  = 'crash-velocity.name'

export type AccountSummary = {
  id:        string;
  username:  string;
  createdAt: number;
}

export type AccountStats = {
  matches:  number;
  kills:    number;
  deaths:   number;
  captures: number;
}

export type AuthOutcome =
  | { ok: true; account: AccountSummary; token: string } |
  { ok: false; error: string }

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

async function submit (path: string, username: string, password: string): Promise<AuthOutcome> {
  let response: Response
  try {
    response = await fetch(path, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    })
  }
  catch {
    return { ok: false, error: 'cannot reach the server' }
  }

  const body = await response.json().catch(() => ({})) as { token?: string; account?: AccountSummary; error?: string }

  if (!response.ok || !body.token || !body.account)
    return { ok: false, error: describe(body.error, response.status) }

  storeToken(body.token)
  storeName(body.account.username)
  return { ok: true, account: body.account, token: body.token }
}

export const register = (username: string, password: string) =>
  submit('/api/auth/register', username, password)

export const login = (username: string, password: string) =>
  submit('/api/auth/login', username, password)

/**
 * Who the stored token belongs to, or null.
 *
 * Lets the lobby render a signed-in identity before the socket connects, and —
 * more usefully — tell an expired token apart from no token, which the socket's
 * silent fall back to guest cannot.
 */
export async function me (): Promise<{ account: AccountSummary; stats: AccountStats } | null> {
  const token = storedToken()
  if (!token)
    return null

  try {
    const response = await fetch('/api/auth/me', { headers: { authorization: `Bearer ${token}` }})
    if (!response.ok)
      return null

    return await response.json() as { account: AccountSummary; stats: AccountStats }
  }
  catch {
    return null
  }
}

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

export async function signOut (): Promise<void> {
  const token = storedToken()

  // Cleared regardless of what the request does. Signing out must never fail
  // because the network did; the worst case is a row that expires on its own.
  try {
    globalThis.localStorage?.removeItem(TOKEN_KEY)
  }
  catch { /* as above */ }

  if (!token)
    return

  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${token}` }})
  }
  catch { /* the session expires by itself within the week */ }
}
