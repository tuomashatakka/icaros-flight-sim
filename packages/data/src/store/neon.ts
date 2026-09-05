/**
 * `Store` on Neon Postgres, over HTTP.
 *
 * The default implementation, and the only one both halves of the deployment
 * can reach: accounts are written by Next route handlers on Vercel and read by
 * the battle server, which is a separate long-lived Bun process on a different
 * machine. A file on one of those machines cannot serve the other.
 *
 * Uses `neon()` — the HTTP query function — rather than `Pool`/`Client` over a
 * WebSocket. Every operation here is either a single statement or a fixed
 * batch, so nothing needs an interactive transaction, and the WebSocket path
 * would mean pinning `neonConfig.webSocketConstructor` to whatever the host
 * runtime happens to provide.
 */

import { neon } from '@neondatabase/serverless'
import { SESSION_TTL_MS } from './store'
import type {
  Account,
  AccountStats,
  MatchPlayerRecord,
  MatchRecord,
  Session,
  Store,
} from './store'


type Sql = ReturnType<typeof neon>

type AccountRow = {
  id:             string;
  username:       string;
  created_at:     string | number;
  password_hash?: string;
}

type StatsRow = {
  matches:  number;
  kills:    number;
  deaths:   number;
  captures: number;
}

/**
 * `bigint` columns arrive as strings.
 *
 * The driver uses pg-types' defaults, where int8 and numeric are strings rather
 * than numbers — Postgres allows values JavaScript cannot represent, so the
 * safe default is lossless text. Every timestamp in this schema is epoch
 * milliseconds (~1.7e12), comfortably inside 2^53, so the coercion is exact.
 * The aggregate columns dodge this with a `::int` cast in the query instead.
 */
const epoch = (value: string | number): number => Number(value)

const toAccount = (row: AccountRow): Account =>
  ({ id: row.id, username: row.username, createdAt: epoch(row.created_at) })


export class NeonStore implements Store {
  private readonly sql: Sql

  constructor (connectionString: string) {
    this.sql = neon(connectionString)
  }

  async createAccount (username: string, passwordHash: string): Promise<Account | null> {
    const account: Account = { id: crypto.randomUUID(), username, createdAt: Date.now() }

    // Untargeted `DO NOTHING`, deliberately: the constraint that can fire is a
    // unique index on the *expression* `lower(username)`, and naming an
    // expression index as a conflict target is easy to get subtly wrong. The
    // only other unique key on this table is the primary key, a fresh UUID, so
    // nothing else can be masked. Zero rows back means the name is taken, which
    // is a normal answer rather than an error.
    const rows = await this.sql `
      INSERT INTO accounts (id, username, password_hash, created_at)
      VALUES (${account.id}, ${account.username}, ${passwordHash}, ${account.createdAt})
      ON CONFLICT DO NOTHING
      RETURNING id
    ` as { id: string }[]

    return rows.length ? account : null
  }

  async findAccount (username: string): Promise<Account & { passwordHash: string } | null> {
    // `$1::text` rather than a bare parameter: Postgres also has `lower(anyrange)`
    // and `lower(anymultirange)`, so an untyped parameter is ambiguous — and the
    // cast is what keeps the expression matching the index expression.
    const rows = await this.sql `
      SELECT id, username, created_at, password_hash
      FROM accounts
      WHERE lower(username) = lower(${username}::text)
    ` as AccountRow[]

    const row = rows[0]
    if (!row)
      return null

    return { ...toAccount(row), passwordHash: row.password_hash as string }
  }

  async accountById (id: string): Promise<Account | null> {
    const rows = await this.sql `
      SELECT id, username, created_at FROM accounts WHERE id = ${id}
    ` as AccountRow[]

    return rows[0] ? toAccount(rows[0]) : null
  }

  async createSession (accountId: string, ttlMs = SESSION_TTL_MS): Promise<Session> {
    const session: Session = {
      token:     crypto.randomUUID(),
      accountId,
      expiresAt: Date.now() + ttlMs,
    }

    // One round trip for both. The second statement is the same opportunistic
    // sweep the SQLite implementation does: a cron for expired rows would be one
    // more moving part for a table that only grows when someone signs in.
    // The queries are passed un-awaited on purpose — `transaction()` takes the
    // query objects, not their results.
    await this.sql.transaction([
      this.sql `
        INSERT INTO sessions (token, account_id, expires_at)
        VALUES (${session.token}, ${session.accountId}, ${session.expiresAt})
      `,
      this.sql `DELETE FROM sessions WHERE expires_at <= ${Date.now()}`,
    ])

    return session
  }

  async resolveSession (token: string): Promise<Account | null> {
    // One statement rather than SQLite's three. This runs on every lobby socket
    // connect, and over HTTP each statement is a network round trip.
    //
    // Divergence from SQLite worth knowing: an expired token is not deleted
    // here, only ignored. The sweep in `createSession` collects it. Both answer
    // `null`, which is all the contract and every caller depend on.
    const rows = await this.sql `
      SELECT a.id, a.username, a.created_at
      FROM sessions s
      JOIN accounts a ON a.id = s.account_id
      WHERE s.token = ${token} AND s.expires_at > ${Date.now()}
    ` as AccountRow[]

    return rows[0] ? toAccount(rows[0]) : null
  }

  async dropSession (token: string): Promise<void> {
    await this.sql `DELETE FROM sessions WHERE token = ${token}`
  }

  async recordMatchStart (record: MatchRecord): Promise<void> {
    // `ON CONFLICT … DO UPDATE`, never a delete-and-reinsert: `match_players`
    // cascades from this row, so replacing it would silently take the roster
    // with it.
    await this.sql `
      INSERT INTO matches (id, mode, arena, started_at, ended_at, winner, scores)
      VALUES (
        ${record.id}, ${record.mode}, ${record.arena}, ${record.startedAt},
        ${record.endedAt}, ${record.winner}, ${JSON.stringify(record.scores)}::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        mode       = EXCLUDED.mode,
        arena      = EXCLUDED.arena,
        started_at = EXCLUDED.started_at,
        ended_at   = EXCLUDED.ended_at,
        winner     = EXCLUDED.winner,
        scores     = EXCLUDED.scores
    `
  }

  async recordMatchEnd (id: string, endedAt: number, winner: string | null, scores: Record<string, number>): Promise<void> {
    await this.sql `
      UPDATE matches
      SET ended_at = ${endedAt}, winner = ${winner}, scores = ${JSON.stringify(scores)}::jsonb
      WHERE id = ${id}
    `
  }

  async recordMatchPlayers (players: MatchPlayerRecord[]): Promise<void> {
    // `transaction()` rejects an empty batch, and a match with no roster is a
    // normal thing to be asked to record.
    if (players.length === 0)
      return

    // One transaction: a half-written roster is worse than none, and this runs
    // at match end while the tick loop is still going.
    await this.sql.transaction(players.map(p => this.sql `
      INSERT INTO match_players (match_id, account_id, name, team, kills, deaths, captures)
      VALUES (${p.matchId}, ${p.accountId}, ${p.name}, ${p.team}, ${p.kills}, ${p.deaths}, ${p.captures})
      ON CONFLICT (match_id, name) DO UPDATE SET
        account_id = EXCLUDED.account_id,
        team       = EXCLUDED.team,
        kills      = EXCLUDED.kills,
        deaths     = EXCLUDED.deaths,
        captures   = EXCLUDED.captures
    `))
  }

  async statsFor (accountId: string): Promise<AccountStats> {
    // `::int` on every aggregate: `count()` is int8 and `sum(integer)` is
    // bigint, both of which the driver would hand back as strings. Casting in
    // the query is cheaper than coercing four fields, and it fails loudly if a
    // total ever genuinely overflows int4 rather than silently going lossy.
    const rows = await this.sql `
      SELECT COUNT(DISTINCT match_id)::int   AS matches,
             COALESCE(SUM(kills), 0)::int    AS kills,
             COALESCE(SUM(deaths), 0)::int   AS deaths,
             COALESCE(SUM(captures), 0)::int AS captures
      FROM match_players WHERE account_id = ${accountId}
    ` as StatsRow[]

    return rows[0] ?? { matches: 0, kills: 0, deaths: 0, captures: 0 }
  }

  /** Nothing to close: every query is its own HTTP request. */
  close (): void {}
}
