/**
 * The lap/checkpoint state machine, as a pure reducer.
 *
 * This used to live inside a zustand store, which meant race's rules could only
 * run in a browser, for exactly one ship. Nothing here touches a store, a
 * renderer or a clock — it takes a progress record and a dt and returns what
 * happened, so the server can run sixteen of them and the client can predict
 * its own.
 *
 * Every rule the store enforced is preserved:
 *
 *   · gates count only in order, so cutting the course does nothing
 *   · the finish line is gate 0 on a loop, the LAST gate on a sprint
 *   · a lap time is taken at the instant of the crossing, never from a mirror
 *     that is up to a commit period stale
 *   · the respawn target follows the last gate cleared
 */

import type { Transform } from 'Φtypes'


export type RaceStatus = 'lobby' | 'countdown' | 'racing' | 'finished'

export type RaceRules = {
  checkpointCount: number;
  laps:            number;
  loop:            boolean;
}

export type RaceProgress = {
  lap:            number;
  nextCheckpoint: number;
  elapsed:        number;
  lapElapsed:     number;
  lapTimes:       number[];
  bestLap:        number | null;
  finished:       boolean;
  finishTime:     number | null;

  /** Gates cleared in total. The ordering key for live position. */
  gatesCleared: number;

  respawn:      Transform;
  respawnIndex: number;
}

export type GateResult =
  | { counted: false } |
  { counted: true; lapCompleted: boolean; lapTime: number; finished: boolean }

export const COUNTDOWN_SECONDS = 3

export function createProgress (rules: RaceRules, spawn: Transform): RaceProgress {
  return {
    lap:            1,
    // On a loop the ship spawns just past gate 0, so it is chasing #1 first.
    nextCheckpoint: rules.checkpointCount > 1 ? 1 % rules.checkpointCount : 0,
    elapsed:        0,
    lapElapsed:     0,
    lapTimes:       [],
    bestLap:        null,
    finished:       false,
    finishTime:     null,
    gatesCleared:   0,
    respawn:        spawn,
    respawnIndex:   0,
  }
}

/** Advance one racer's clocks. Only meaningful while the race is running. */
export function tickProgress (progress: RaceProgress, dt: number): void {
  if (progress.finished)
    return

  progress.elapsed    += dt
  progress.lapElapsed += dt
}

/**
 * Apply a gate crossing.
 *
 * Returns whether it counted and, if it closed a lap, the exact time — the
 * caller turns that into an event. Out-of-order crossings return
 * `{ counted: false }` and change nothing at all, which is what makes a
 * shortcut worthless rather than merely slow.
 */
export function passCheckpoint (
  progress: RaceProgress,
  index: number,
  transform: Transform,
  rules: RaceRules,
): GateResult {
  if (progress.finished || index !== progress.nextCheckpoint)
    return { counted: false }

  const count      = rules.checkpointCount
  progress.respawn = transform
  progress.gatesCleared++

  const isFinishLine = rules.loop ? index === 0 : index === count - 1
  if (!isFinishLine) {
    progress.nextCheckpoint = (index + 1) % count
    return { counted: true, lapCompleted: false, lapTime: 0, finished: false }
  }

  const lapTime = progress.lapElapsed
  progress.lapTimes.push(lapTime)
  progress.bestLap    = progress.bestLap === null ? lapTime : Math.min(progress.bestLap, lapTime)
  progress.lapElapsed = 0

  if (progress.lap >= rules.laps) {
    progress.finished   = true
    progress.finishTime = progress.elapsed
    return { counted: true, lapCompleted: true, lapTime, finished: true }
  }

  progress.lap++
  progress.nextCheckpoint = count > 1 ? 1 : 0
  return { counted: true, lapCompleted: true, lapTime, finished: false }
}

/** Send a racer back to the last gate they cleared. */
export function respawnAt (progress: RaceProgress): Transform {
  progress.respawnIndex = progress.respawnIndex + 1 & 0xff
  return progress.respawn
}

/**
 * Live standings.
 *
 * Ordered by gates cleared, then by who got there first — a racer who has
 * cleared the same gate earlier in the race is ahead, which is the only
 * ordering that stays stable while two ships are side by side on the same gate.
 * Finishers sort above everyone, by finishing time.
 */
export function standings<T extends { id: string; progress: RaceProgress }> (racers: readonly T[]): T[] {
  return [ ...racers ].sort((a, b) => {
    if (a.progress.finished !== b.progress.finished)
      return a.progress.finished ? -1 : 1

    if (a.progress.finished && b.progress.finished)
      return (a.progress.finishTime ?? 0) - (b.progress.finishTime ?? 0)

    if (a.progress.gatesCleared !== b.progress.gatesCleared)
      return b.progress.gatesCleared - a.progress.gatesCleared

    return a.progress.elapsed - b.progress.elapsed
  })
}

/** mm:ss.mmm formatter for lap and total times. */
export function formatTime (seconds: number): string {
  if (!Number.isFinite(seconds))
    return '--:--'

  const m  = Math.floor(seconds / 60)
  const s  = Math.floor(seconds % 60)
  const ms = Math.floor(seconds % 1 * 1000)
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`
}
