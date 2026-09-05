/**
 * Persistence, behind an interface.
 *
 * Two implementations: `SqliteStore` for a running server and `MemoryStore` for
 * tests. The split is not ceremony — vitest's node runtime cannot import a
 * `bun:` builtin, so every test that is not specifically about SQL runs against
 * memory, and the sqlite implementation is covered by `bun test` instead.
 *
 * It also keeps the hosting promise honest: swapping this for Postgres is one
 * file, and nothing above it knows which is underneath.
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
