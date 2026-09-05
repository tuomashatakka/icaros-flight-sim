/**
 * Persistence, behind an interface.
 *
 * Three implementations, and the split is not ceremony:
 *
 * - `NeonStore` (here) — Neon Postgres over HTTP. The default, and the only one
 *   both hosts can reach: accounts are written by Next route handlers on Vercel
 *   and read by the battle server, which are different processes on different
 *   machines running different runtimes.
 * - `MemoryStore` (here) — tests, and a throwaway LAN session.
 * - `SqliteStore` (`packages/server`) — a local file for offline development.
 *   It lives over there rather than here because it imports `bun:sqlite`, and
 *   this package has to typecheck and run under Node as well.
 *
 * Everything above this interface is written against it and knows nothing about
 * which is underneath — which is what made moving off SQLite one new file.
 */

export type Account = {
  id:        string;
  username:  string;
  createdAt: number;
}

export type Session = {
  token:     string;
  accountId: string;
  expiresAt: number;
}

export type MatchRecord = {
  id:        string;
  mode:      string;
  arena:     string;
  startedAt: number;
  endedAt:   number | null;
  winner:    string | null;
  scores:    Record<string, number>;
}

export type MatchPlayerRecord = {
  matchId:   string;
  accountId: string | null;
  name:      string;
  team:      string;
  kills:     number;
  deaths:    number;
  captures:  number;
}

export type AccountStats = {
  matches:  number;
  kills:    number;
  deaths:   number;
  captures: number;
}

export interface Store {

  /** Fails when the username is taken; usernames are the only unique key. */
  createAccount (username: string, passwordHash: string): Promise<Account | null>

  findAccount (username: string): Promise<Account & { passwordHash: string } | null>
  accountById (id: string): Promise<Account | null>

  createSession (accountId: string, ttlMs: number): Promise<Session>
  resolveSession (token: string): Promise<Account | null>
  dropSession (token: string): Promise<void>

  recordMatchStart (record: MatchRecord): Promise<void>
  recordMatchEnd (id: string, endedAt: number, winner: string | null, scores: Record<string, number>): Promise<void>
  recordMatchPlayers (players: MatchPlayerRecord[]): Promise<void>

  statsFor (accountId: string): Promise<AccountStats>

  close (): void
}

// Sessions last a week: long enough that a returning player is still signed in,
//  short enough that a leaked token is not forever.
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
