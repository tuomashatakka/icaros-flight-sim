/**
 * Match history.
 *
 * Every one of these used to exist, be covered by a contract test, and be
 * called by nothing — which is why `statsFor` returned zeroes for the life of
 * the previous implementation. The Colyseus rooms call them on dispose now.
 */

import { eq, sql } from 'drizzle-orm'

import { matchPlayers, matches, raceResults } from '../schema'

import type { Database } from '../client'


export type MatchRecord = {
  id:        string;
  mode:      string;
  arena:     string;
  startedAt: number;
  endedAt?:  number | null;
  winner?:   string | null;
  scores:    Record<string, number>;
}

export type MatchPlayerRecord = {
  matchId:  string;
  userId:   string | null;
  name:     string;
  team:     string;
  kills:    number;
  deaths:   number;
  captures: number;
}

export type RaceResultRecord = {
  matchId:   string;
  userId:    string | null;
  name:      string;
  position:  number;
  laps:      number;
  totalTime: number | null;
  bestLap:   number | null;
  lapTimes:  number[];
  finished:  boolean;
}

export async function recordMatchStart (db: Database, record: MatchRecord): Promise<void> {
  await db
    .insert(matches)
    .values({ ...record, endedAt: record.endedAt ?? null, winner: record.winner ?? null })
    .onConflictDoNothing()
}

export async function recordMatchEnd (
  db: Database,
  id: string,
  endedAt: number,
  winner: string | null,
  scores: Record<string, number>,
): Promise<void> {
  await db.update(matches).set({ endedAt, winner, scores })
    .where(eq(matches.id, id))
}

/**
 * Upsert, never delete-then-insert: the roster is written once at match end but
 * a reconnect can rewrite a row, and a delete would cascade the race result
 * hanging off the same match.
 */
export async function recordMatchPlayers (db: Database, players: MatchPlayerRecord[]): Promise<void> {
  if (players.length === 0)
    return

  await db
    .insert(matchPlayers)
    .values(players)
    .onConflictDoUpdate({
      target: [ matchPlayers.matchId, matchPlayers.name ],
      set:    {
        userId:   sqlExcluded('user_id'),
        team:     sqlExcluded('team'),
        kills:    sqlExcluded('kills'),
        deaths:   sqlExcluded('deaths'),
        captures: sqlExcluded('captures'),
      },
    })
}

export async function recordRaceResults (db: Database, results: RaceResultRecord[]): Promise<void> {
  if (results.length === 0)
    return

  await db
    .insert(raceResults)
    .values(results.map(r => ({ ...r, finished: r.finished ? 1 : 0 })))
    .onConflictDoUpdate({
      target: [ raceResults.matchId, raceResults.name ],
      set:    {
        userId:    sqlExcluded('user_id'),
        position:  sqlExcluded('position'),
        laps:      sqlExcluded('laps'),
        totalTime: sqlExcluded('total_time'),
        bestLap:   sqlExcluded('best_lap'),
        lapTimes:  sqlExcluded('lap_times'),
        finished:  sqlExcluded('finished'),
      },
    })
}

// `excluded` is the row the insert would have written. Drizzle has no helper
//  for it, and spelling the column name is the whole of the abstraction.
function sqlExcluded (column: string) {
  return sql.raw(`excluded.${column}`)
}
