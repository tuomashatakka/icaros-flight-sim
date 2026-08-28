/**
 * In-memory `Store`. Nothing survives a restart, which is the point.
 *
 * Used by tests and by a server started with no `DB_PATH` — a throwaway LAN
 * session should not leave a database file behind.
 */

import { SESSION_TTL_MS } from './store'
import type {
  Account,
  AccountStats,
  MatchPlayerRecord,
  MatchRecord,
  Session,
  Store,
} from './store'


type StoredAccount = Account & { passwordHash: string }

export class MemoryStore implements Store {
  private readonly accounts = new Map<string, StoredAccount>()
  private readonly byName = new Map<string, string>()
  private readonly sessions = new Map<string, Session>()
  private readonly matches = new Map<string, MatchRecord>()
  private readonly rosters: MatchPlayerRecord[] = []

  async createAccount (username: string, passwordHash: string): Promise<Account | null> {
    const key = username.toLowerCase()
    if (this.byName.has(key))
      return null

    const account: StoredAccount = {
      id:        crypto.randomUUID(),
      username,
      createdAt: Date.now(),
      passwordHash,
    }

    this.accounts.set(account.id, account)
    this.byName.set(key, account.id)
    return { id: account.id, username: account.username, createdAt: account.createdAt }
  }

  async findAccount (username: string): Promise<StoredAccount | null> {
    const id = this.byName.get(username.toLowerCase())
    return id ? this.accounts.get(id) ?? null : null
  }

  async accountById (id: string): Promise<Account | null> {
    const found = this.accounts.get(id)
    return found ? { id: found.id, username: found.username, createdAt: found.createdAt } : null
  }

  async createSession (accountId: string, ttlMs = SESSION_TTL_MS): Promise<Session> {
    const session: Session = {
      token:     crypto.randomUUID(),
      accountId,
      expiresAt: Date.now() + ttlMs,
    }
    this.sessions.set(session.token, session)
    return session
  }

  async resolveSession (token: string): Promise<Account | null> {
    const session = this.sessions.get(token)
    if (!session)
      return null

    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(token)
      return null
    }

    return this.accountById(session.accountId)
  }

  async dropSession (token: string): Promise<void> {
    this.sessions.delete(token)
  }

  async recordMatchStart (record: MatchRecord): Promise<void> {
    this.matches.set(record.id, { ...record })
  }

  async recordMatchEnd (id: string, endedAt: number, winner: string | null, scores: Record<string, number>): Promise<void> {
    const match = this.matches.get(id)
    if (match)
      Object.assign(match, { endedAt, winner, scores })
  }

  async recordMatchPlayers (players: MatchPlayerRecord[]): Promise<void> {
    this.rosters.push(...players.map(p => ({ ...p })))
  }

  async statsFor (accountId: string): Promise<AccountStats> {
    const mine = this.rosters.filter(r => r.accountId === accountId)
    return {
      matches:  new Set(mine.map(r => r.matchId)).size,
      kills:    mine.reduce((sum, r) => sum + r.kills, 0),
      deaths:   mine.reduce((sum, r) => sum + r.deaths, 0),
      captures: mine.reduce((sum, r) => sum + r.captures, 0),
    }
  }

  close (): void {}
}
