'use client'

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'


export type RaceStatus = 'idle' | 'countdown' | 'racing' | 'finished'

// Defined in the sim layer — the physics owns the pose type, and it must not
// import a zustand store to get at it. Re-exported for the existing call sites.
export type { Transform } from '@crash-velocity/physics/types'
import type { Transform } from '@crash-velocity/physics/types'


type RaceConfig = {
  checkpointCount: number;
  laps:            number;

  /** Closed circuit (lap-based) vs. open sprint (single run to the last checkpoint). */
  loop: boolean;

  /** Where the vehicle starts — also the first respawn target. */
  spawn: Transform;
}

export type RaceState = {
  status: RaceStatus;

  /** Seconds remaining on the 3-2-1 countdown (drives the big HUD number). */
  countdown:       number;
  laps:            number;
  loop:            boolean;
  checkpointCount: number;
  currentLap:      number;

  /** Index of the checkpoint we expect to cross next. */
  nextCheckpoint: number;

  /** Total race time + the in-progress lap time, in seconds. */
  elapsed:    number;
  lapElapsed: number;
  lapTimes:   number[];
  bestLap:    number | null;

  /** Last passed checkpoint transform — respawn target. */
  respawn: Transform;

  /** Race start transform — respawn target on restart. */
  spawn: Transform;

  configureRace: (config: RaceConfig) => void;
  tick:          (dt: number) => void;

  /** Called by a checkpoint sensor when the vehicle crosses it. Returns true if it counted. */
  passCheckpoint: (index: number, transform: Transform) => boolean;
  resetRace:      () => void;
}

const DEFAULT_SPAWN: Transform = { position: [ 1, 2, 4 ], quaternion: [ 0, 1, 0, 0 ]}

/**
 * The live race clocks, as a plain mutable object.
 *
 * Same reasoning as `src/engine/telemetry.ts`: these advance every 60 Hz sim
 * step, and writing them into zustand at that rate forces 60 React commits a
 * second — which quietly defeated the 15 Hz throttling in the publish module,
 * since the race bar was re-rendering on every step anyway.
 *
 * The holographic HUD reads these directly at its texture cadence, so it stays
 * exact to the millisecond; the store mirrors them on a throttle for other
 * consumers.
 */
export const raceTimers = { elapsed: 0, lapElapsed: 0, countdown: 3 }

/** Store mirror period, matching `PUBLISH_PERIOD` in the publish module. */
const COMMIT_PERIOD = 1 / 15

let sinceCommit = 0

function resetTimers (countdown = 3) {
  raceTimers.elapsed    = 0
  raceTimers.lapElapsed = 0
  raceTimers.countdown  = countdown
  sinceCommit = 0
}

export const useRaceStore = create<RaceState>()(
  subscribeWithSelector((set, get) => ({
    status:          'idle',
    countdown:       3,
    laps:            3,
    loop:            true,
    checkpointCount: 0,
    currentLap:      1,
    nextCheckpoint:  1,
    elapsed:         0,
    lapElapsed:      0,
    lapTimes:        [],
    bestLap:         null,
    respawn:         DEFAULT_SPAWN,
    spawn:           DEFAULT_SPAWN,

    configureRace: ({ checkpointCount, laps, loop, spawn }) => {
      resetTimers()
      set({
        status:         'countdown',
        countdown:      3,
        checkpointCount,
        laps,
        loop,
        currentLap:     1,
        // On a loop the ship spawns just past checkpoint 0, so it's chasing #1 first.
        nextCheckpoint: 1 % Math.max(checkpointCount, 1),
        elapsed:        0,
        lapElapsed:     0,
        lapTimes:       [],
        bestLap:        null,
        respawn:        spawn,
        spawn,
      })
    },

    tick: dt => {
      const s = get()
      if (s.status === 'countdown') {
        const previous       = raceTimers.countdown
        const next           = previous - dt
        raceTimers.countdown = next

        if (next <= 0) {
          set({ status: 'racing', countdown: 0 })
          return
        }

        // The overlay renders `Math.ceil(countdown)`, so committing the raw
        // value every step would fire ~180 commits to change the digit twice.
        if (Math.ceil(next) !== Math.ceil(previous))
          set({ countdown: next })
        return
      }

      if (s.status !== 'racing')
        return

      raceTimers.elapsed += dt
      raceTimers.lapElapsed += dt
      sinceCommit += dt

      if (sinceCommit >= COMMIT_PERIOD) {
        sinceCommit = 0
        set({ elapsed: raceTimers.elapsed, lapElapsed: raceTimers.lapElapsed })
      }
    },

    passCheckpoint: (index, transform) => {
      const s = get()
      if (s.status !== 'racing')
        return false
      if (index !== s.nextCheckpoint)
        return false // enforce in-order crossing

      const count        = s.checkpointCount
      const isFinishLine = s.loop ? index === 0 : index === count - 1

      // Always update the respawn target to the checkpoint just cleared.
      const patch: Partial<RaceState> = { respawn: transform }

      if (isFinishLine) {
        // Taken from the live clock, not the store — the store's copy is up to
        // a commit period stale, and a lap time is the one number that has to be
        // exact at the instant of the crossing.
        const lapTime     = raceTimers.lapElapsed
        const lapTimes    = [ ...s.lapTimes, lapTime ]
        const bestLap     = s.bestLap === null ? lapTime : Math.min(s.bestLap, lapTime)
        const finishedLap = s.currentLap

        raceTimers.lapElapsed = 0
        sinceCommit = 0

        if (finishedLap >= s.laps) {
          set({
            ...patch,
            lapTimes,
            bestLap,
            status:     'finished',
            elapsed:    raceTimers.elapsed,
            lapElapsed: 0,
          })
          return true
        }
        set({
          ...patch,
          lapTimes,
          bestLap,
          currentLap:     finishedLap + 1,
          elapsed:        raceTimers.elapsed,
          lapElapsed:     0,
          nextCheckpoint: count > 1 ? 1 : 0,
        })
        return true
      }

      set({ ...patch, nextCheckpoint: (index + 1) % count })
      return true
    },

    resetRace: () => {
      resetTimers()
      set({
        status:         'countdown',
        countdown:      3,
        currentLap:     1,
        nextCheckpoint: get().checkpointCount > 1 ? 1 : 0,
        elapsed:        0,
        lapElapsed:     0,
        lapTimes:       [],
        bestLap:        null,
        respawn:        get().spawn,
      })
    },
  }))
)

/** mm:ss.mmm formatter for lap/total times. */
export function formatTime (seconds: number): string {
  if (!Number.isFinite(seconds))
    return '--:--'

  const m  = Math.floor(seconds / 60)
  const s  = Math.floor(seconds % 60)
  const ms = Math.floor(seconds % 1 * 1000)
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`
}
