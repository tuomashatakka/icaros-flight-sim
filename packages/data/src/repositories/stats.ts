/**
 * Career totals for one pilot.
 *
 * The `::int` casts are not decoration. Postgres `count()` and `sum()` return
 * `bigint`, which both Neon drivers hand back as a *string* to avoid silently
 * truncating past 2^53. Every consumer here is a scoreboard that will never
 * see four billion kills, so the cast happens in SQL where it is exact rather
 * than in JS where it would be a `Number()` guess.
 */

import { eq, sql } from 'drizzle-orm'

import { matchPlayers, raceResults } from '../schema'

import type { Database } from '../client'


export type PilotStats = {
  matches:   number;
  kills:     number;
  deaths:    number;
  captures:  number;
  races:     number;
  wins:      number;
  bestLap:   number | null;
}

const EMPTY: PilotStats = { matches: 0, kills: 0, deaths: 0, captures: 0, races: 0, wins: 0, bestLap: null }

export async function statsFor (db: Database, userId: string): Promise<PilotStats> {
  const [ combat ] = await db
    .select({
      matches:  sql<number>`count(*)::int`,
      kills:    sql<number>`coalesce(sum(${matchPlayers.kills}), 0)::int`,
      deaths:   sql<number>`coalesce(sum(${matchPlayers.deaths}), 0)::int`,
      captures: sql<number>`coalesce(sum(${matchPlayers.captures}), 0)::int`,
    })
    .from(matchPlayers)
    .where(eq(matchPlayers.userId, userId))

  const [ racing ] = await db
    .select({
      races:   sql<number>`count(*)::int`,
      wins:    sql<number>`count(*) filter (where ${raceResults.position} = 1)::int`,
      bestLap: sql<number | null>`min(${raceResults.bestLap})`,
    })
    .from(raceResults)
    .where(eq(raceResults.userId, userId))

  return {
    ...EMPTY,
    ...combat,
    ...racing,
    bestLap: racing?.bestLap ?? null,
  }
}
