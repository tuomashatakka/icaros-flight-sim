'use client'

/**
 * The race HUD's slice of the server's state.
 *
 * This used to BE the race: the lap rules, the finish line, the clocks and the
 * respawn target all lived in here, driven by rapier sensor collisions from a
 * browser module. That meant race could only ever run in one tab, for one ship,
 * and none of it could be tested without driving the game.
 *
 * The rules are `@crash-velocity/race`'s now, and this is what is left — a
 * mirror, written by the scene at the publish throttle and read by React. It
 * has no actions that change the race, because a client cannot change a race.
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'

import type { RaceStatus } from '@crash-velocity/race'


export type { RaceStatus }
export type { Transform } from '@crash-velocity/physics/types'

export type Standing = {
  id:       string;
  name:     string;
  position: number;
  lap:      number;
  bestLap:  number | null;
  finished: boolean;
  isBot:    boolean;
}

export type RaceHudState = {
  status:    RaceStatus;
  countdown: number;
  laps:      number;
  trackId:   string;

  currentLap:     number;
  nextCheckpoint: number;

  // Track shape, mirrored so the HUD can label "gate 3 of 16" without holding
  //  the track itself.
  checkpointCount: number;
  loop:            boolean;
  position:        number;
  gridSize:        number;

  elapsed:    number;
  lapElapsed: number;
  lapTimes:   number[];
  bestLap:    number | null;
  finished:   boolean;

  standings: Standing[];

  /**
   * Why the game server could not be reached, or `null`.
   *
   * Race is network-only now, so a failed join is not a degraded race — it is
   * no race. Without this the HUD would sit on the initial `lobby` status with
   * a motionless ship and say nothing, because the sync below the fold never
   * runs when there is no server state to sync.
   */
  linkError: string | null;

  /** Written by the scene once per publish period. */
  sync:  (next: Partial<RaceHudState>) => void;
  reset: () => void;
}

const initial = {
  status:          'lobby' as RaceStatus,
  countdown:       0,
  laps:            3,
  trackId:         'flats',
  currentLap:      1,
  nextCheckpoint:  1,
  checkpointCount: 0,
  loop:            true,
  position:        1,
  gridSize:        1,
  elapsed:         0,
  lapElapsed:      0,
  lapTimes:        [] as number[],
  bestLap:         null,
  finished:        false,
  standings:       [] as Standing[],
  linkError:       null as string | null,
}

/**
 * The live clocks, as a plain mutable object.
 *
 * Same reasoning as `src/engine/telemetry.ts`: these advance every sim step,
 * and writing them into zustand at that rate forces 60 React commits a second.
 * The holographic HUD reads these directly at its texture cadence so it stays
 * exact to the millisecond; the store mirrors them on a throttle for React.
 */
export const raceTimers = { elapsed: 0, lapElapsed: 0, countdown: 3 }

export function resetRaceTimers (countdown = 3): void {
  raceTimers.elapsed    = 0
  raceTimers.lapElapsed = 0
  raceTimers.countdown  = countdown
}

export const useRaceStore = create<RaceHudState>()(
  subscribeWithSelector(set => ({
    ...initial,
    sync:  next => set(next),
    reset: () => {
      resetRaceTimers()
      set(initial)
    },
  }))
)

// mm:ss.mmm formatter for lap and total times. Re-exported from the rules so
//  the HUD and a match record format a time identically.
export { formatTime } from '@crash-velocity/race'
