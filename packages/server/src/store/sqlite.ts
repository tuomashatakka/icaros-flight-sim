/**
 * `Store` on `bun:sqlite`.
 *
 * SQLite because it is built into Bun — no dependency, no service to run, and a
 * hobby server's whole database is a file you can copy. Swapping it for
 * Postgres later is this one file; nothing above the `Store` interface knows
 * which is underneath.
 *
 * NOTE: this module imports `bun:sqlite`, so it can only be loaded under Bun.
 * That is why the interface exists and why every test that is not specifically
 * about SQL uses `MemoryStore` — vitest runs on node and cannot import it.
 */

import { Database } from 'bun:sqlite'
import { dirname } from 'node:path'
import { mkdirSync, readFileSync } from 'node:fs'
import { SESSION_TTL_MS } from './store'
import type {
  Account,
  AccountStats,
  MatchPlayerRecord,
  MatchRecord,
  Session,
  Store,
} from './store'


type AccountRow = {
  id:            string;
  username:      string;
  password_hash: string;
  created_at:    number;
}

/**
 * Read at module load, not lazily: the server must not accept a connection
 * before its tables exist, and an async read would let it.
 */
const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')

export class SqliteStore implements Store {
  private readonly db: Database

  constructor (path: string) {
    if (path !== ':memory:')
      mkdirSync(dirname(path), { recursive: true })

    this.db = new Database(path, { create: true })

    // WAL: readers never block the writer, which matters because the tick loop
    // and an HTTP login share this process and neither may stall the other.
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.db.exec(SCHEMA)
  }

  async createAccount (username: string, passwordHash: string): Promise<Account | null> {
    const account: Account = { id: crypto.randomUUID(), username, createdAt: Date.now() }

    try {
      this.db.query('INSERT INTO accounts (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .run(account.id, account.username, passwordHash, account.createdAt)
    }
    catch {
      // The unique index on lower(username) is the only thing that can fail
      // here, and "taken" is a normal answer rather than an error.
      return null
    }

    return account
  }

  async findAccount (username: string): Promise<(Account & { passwordHash: string }) | null> {
    const row = this.db.query('SELECT * FROM accounts WHERE lower(username) = lower(?)')
      .get(username) as AccountRow | null
    if (!row)
      return null

    return { id: row.id, username: row.username, createdAt: row.created_at, passwordHash: row.password_hash }
  }

  async accountById (id: string): Promise<Account | null> {
    const row = this.db.query('SELECT id, username, created_at FROM accounts WHERE id = ?')
      .get(id) as Omit<AccountRow, 'password_hash'> | null
    return row ? { id: row.id, username: row.username, createdAt: row.created_at } : null
  }

  async createSession (accountId: string, ttlMs = SESSION_TTL_MS): Promise<Session> {
    const session: Session = {
      token:     crypto.randomUUID(),
      accountId,
      expiresAt: Date.now() + ttlMs,
    }

    this.db.query('INSERT INTO sessions (token, account_id, expires_at) VALUES (?, ?, ?)')
      .run(session.token, session.accountId, session.expiresAt)

    // Opportunistic sweep. A cron for expired rows would be one more moving
    // part for a table that only grows when someone signs in.
    this.db.query('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
    return session
  }

  async resolveSession (token: string): Promise<Account | null> {
    const row = this.db.query('SELECT account_id, expires_at FROM sessions WHERE token = ?')
      .get(token) as { account_id: string; expires_at: number } | null

    if (!row)
      return null

    if (row.expires_at <= Date.now()) {
      await this.dropSession(token)
      return null
    }

    return this.accountById(row.account_id)
  }

  async dropSession (token: string): Promise<void> {
    this.db.query('DELETE FROM sessions WHERE token = ?').run(token)
  }

  async recordMatchStart (record: MatchRecord): Promise<void> {
    this.db.query('INSERT OR REPLACE INTO matches (id, mode, arena, started_at, ended_at, winner, scores) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(record.id, record.mode, record.arena, record.startedAt, record.endedAt, record.winner, JSON.stringify(record.scores))
  }

  async recordMatchEnd (id: string, endedAt: number, winner: string | null, scores: Record<string, number>): Promise<void> {
    this.db.query('UPDATE matches SET ended_at = ?, winner = ?, scores = ? WHERE id = ?')
      .run(endedAt, winner, JSON.stringify(scores), id)
  }

  async recordMatchPlayers (players: MatchPlayerRecord[]): Promise<void> {
    const insert = this.db.query(
      'INSERT OR REPLACE INTO match_players (match_id, account_id, name, team, kills, deaths, captures) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )

    // One transaction: a half-written roster is worse than none, and this runs
    // at match end when the tick loop is still going.
    this.db.transaction(() => {
      for (const p of players)
        insert.run(p.matchId, p.accountId, p.name, p.team, p.kills, p.deaths, p.captures)
    })()
  }

  async statsFor (accountId: string): Promise<AccountStats> {
    const row = this.db.query(`
      SELECT COUNT(DISTINCT match_id) AS matches,
             COALESCE(SUM(kills), 0)    AS kills,
             COALESCE(SUM(deaths), 0)   AS deaths,
             COALESCE(SUM(captures), 0) AS captures
      FROM match_players WHERE account_id = ?
    `).get(accountId) as AccountStats | null

    return row ?? { matches: 0, kills: 0, deaths: 0, captures: 0 }
  }

  close (): void {
    this.db.close()
  }
}
