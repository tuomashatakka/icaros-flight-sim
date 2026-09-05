/**
 * The whole database, as Drizzle tables.
 *
 * Two families live here and the split matters:
 *
 * - **Auth.js tables** (`users`, `oauthAccounts`, `sessions`,
 *   `verificationTokens`) have the shape `@auth/drizzle-adapter` requires.
 *   Their column names are the adapter's, not ours, and their `timestamp`
 *   columns are the adapter's too — that is the one place epoch-ms would break
 *   a library contract.
 * - **Game tables** (`matches`, `matchPlayers`, `raceResults`) are ours, and
 *   keep the conventions the old hand-written SQL earned the hard way.
 *
 * `users` carries `username` and `passwordHash` as extra columns rather than
 * living beside a second identity table. Auth.js tolerates extra columns; two
 * tables that both mean "a pilot" would need reconciling forever.
 */

import { sql } from 'drizzle-orm'
import { bigint, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'


// ---------------------------------------------------------------- identity

export const users = pgTable('users', {
  // `text`, not `uuid`: callers round-trip the exact string `randomUUID()`
  // produced, and `uuid` normalises casing.
  id:            text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),

  // Auth.js's own columns. `email` is nullable and unused today — this is a
  // game login, not an identity provider — but the adapter reads it, and
  // Postgres lets a unique index hold many nulls.
  name:          text('name'),
  email:         text('email').unique(),
  emailVerified: timestamp('email_verified', { mode: 'date' }),
  image:         text('image'),

  // Ours. Nullable so an OAuth account added later needs no password.
  username:      text('username').notNull(),
  passwordHash:  text('password_hash'),

  // Epoch milliseconds, not `timestamptz`: every caller compares against
  // `Date.now()`, so a timestamp column would buy nothing and cost a
  // conversion at each edge.
  createdAt:     bigint('created_at', { mode: 'number' }).notNull(),
}, table => [
  // Case-insensitive, so `Pilot` and `pilot` cannot both be registered and then
  // be confused for one another in a roster.
  uniqueIndex('users_username').on(sql`lower(${table.username})`),
])

/**
 * Auth.js's OAuth link table. Empty while Credentials is the only provider,
 * and present because the adapter's contract is all-or-nothing — adding a
 * provider later should be a config line, not a migration scramble.
 */
export const oauthAccounts = pgTable('oauth_accounts', {
  userId:            text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type:              text('type').notNull(),
  provider:          text('provider').notNull(),
  providerAccountId: text('provider_account_id').notNull(),
  refresh_token:     text('refresh_token'),
  access_token:      text('access_token'),
  expires_at:        integer('expires_at'),
  token_type:        text('token_type'),
  scope:             text('scope'),
  id_token:          text('id_token'),
  session_state:     text('session_state'),
}, table => [
  primaryKey({ columns: [ table.provider, table.providerAccountId ] }),
])

/**
 * Auth.js database sessions. Unused while the strategy is JWT — the Credentials
 * provider forces that — but the adapter expects the table to exist, and it is
 * what a future OAuth provider would write to.
 */
export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId:       text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires:      timestamp('expires', { mode: 'date' }).notNull(),
})

export const verificationTokens = pgTable('verification_tokens', {
  identifier: text('identifier').notNull(),
  token:      text('token').notNull(),
  expires:    timestamp('expires', { mode: 'date' }).notNull(),
}, table => [
  primaryKey({ columns: [ table.identifier, table.token ] }),
])


// ------------------------------------------------------------------- games

export const matches = pgTable('matches', {
  id:        text('id').primaryKey(),

  // 'battle' or 'race'. Free text rather than an enum: a new mode should not
  // need a migration before it can record a single match.
  mode:      text('mode').notNull(),
  arena:     text('arena').notNull(),
  startedAt: bigint('started_at', { mode: 'number' }).notNull(),
  endedAt:   bigint('ended_at', { mode: 'number' }),
  winner:    text('winner'),
  scores:    jsonb('scores').$type<Record<string, number>>().notNull(),
})

export const matchPlayers = pgTable('match_players', {
  matchId:  text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),

  // Null for guests and bots. They still get a row, so a match's roster is
  // complete even when most of it was never signed in.
  userId:   text('user_id').references(() => users.id, { onDelete: 'set null' }),

  name:     text('name').notNull(),
  team:     text('team').notNull(),
  kills:    integer('kills').notNull().default(0),
  deaths:   integer('deaths').notNull().default(0),
  captures: integer('captures').notNull().default(0),
}, table => [
  primaryKey({ columns: [ table.matchId, table.name ] }),
  index('match_players_user').on(table.userId),
])

/**
 * Race results, which battle has no equivalent of: a finishing position and a
 * lap history per pilot per match. Lap times are seconds as `real` — they are
 * displayed to three decimals and never summed into anything that would notice
 * float drift.
 */
export const raceResults = pgTable('race_results', {
  matchId:    text('match_id').notNull().references(() => matches.id, { onDelete: 'cascade' }),
  userId:     text('user_id').references(() => users.id, { onDelete: 'set null' }),
  name:       text('name').notNull(),
  position:   integer('position').notNull(),
  laps:       integer('laps').notNull().default(0),
  totalTime:  real('total_time'),
  bestLap:    real('best_lap'),
  lapTimes:   jsonb('lap_times').$type<number[]>().notNull(),
  finished:   integer('finished').notNull().default(0),
}, table => [
  primaryKey({ columns: [ table.matchId, table.name ] }),
  index('race_results_user').on(table.userId),
])

export type UserRow        = typeof users.$inferSelect
export type MatchRow       = typeof matches.$inferSelect
export type MatchPlayerRow = typeof matchPlayers.$inferSelect
export type RaceResultRow  = typeof raceResults.$inferSelect
