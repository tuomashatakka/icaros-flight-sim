/**
 * The data package's public surface.
 *
 * `./migrate` is deliberately absent from this barrel: it reads the generated
 * SQL from disk at import time, and this file is imported by Next route
 * handlers that have no business touching the filesystem. Reach it as
 * `@crash-velocity/data/migrate`.
 */

export { connectionStringOf, describeDatabase, openDatabase, resolveDriver } from './client'
export type { Database, DatabaseDriver, DatabaseHandle, DatabaseOptions } from './client'

export * as schema from './schema'
export { matchPlayers, matches, oauthAccounts, raceResults, sessions, users, verificationTokens } from './schema'
export type { MatchPlayerRow, MatchRow, RaceResultRow, UserRow } from './schema'

export { createPilot, findPilot, pilotById } from './repositories/pilots'
export type { Pilot, PilotWithSecret } from './repositories/pilots'

export { recordMatchEnd, recordMatchPlayers, recordMatchStart, recordRaceResults } from './repositories/matches'
export type { MatchPlayerRecord, MatchRecord, RaceResultRecord } from './repositories/matches'

export { statsFor } from './repositories/stats'
export type { PilotStats } from './repositories/stats'

export { authenticatePilot, registerPilot, validCredentials } from './auth/credentials'
export type { CredentialResult } from './auth/credentials'

export { dummyHash, hashPassword, verifyPassword } from './auth/hash'

export { TICKET_TTL_SECONDS, mintTicket, verifyTicket } from './auth/ticket'
export type { Ticket } from './auth/ticket'
