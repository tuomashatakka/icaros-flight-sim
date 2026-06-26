"use client"

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export type RaceStatus = 'idle' | 'countdown' | 'racing' | 'finished';

export type Transform = {
  position: [number, number, number];
  quaternion: [number, number, number, number];
};

type RaceConfig = {
  checkpointCount: number;
  laps: number;
  /** Closed circuit (lap-based) vs. open sprint (single run to the last checkpoint). */
  loop: boolean;
  /** Where the vehicle starts — also the first respawn target. */
  spawn: Transform;
};

type RaceState = {
  status: RaceStatus;
  /** Seconds remaining on the 3-2-1 countdown (drives the big HUD number). */
  countdown: number;
  laps: number;
  loop: boolean;
  checkpointCount: number;
  currentLap: number;
  /** Index of the checkpoint we expect to cross next. */
  nextCheckpoint: number;
  /** Total race time + the in-progress lap time, in seconds. */
  elapsed: number;
  lapElapsed: number;
  lapTimes: number[];
  bestLap: number | null;
  /** Last passed checkpoint transform — respawn target. */
  respawn: Transform;
  /** Race start transform — respawn target on restart. */
  spawn: Transform;

  configureRace: (config: RaceConfig) => void;
  tick: (dt: number) => void;
  /** Called by a checkpoint sensor when the vehicle crosses it. Returns true if it counted. */
  passCheckpoint: (index: number, transform: Transform) => boolean;
  resetRace: () => void;
};

const DEFAULT_SPAWN: Transform = { position: [1, 2, 4], quaternion: [0, 1, 0, 0] };

export const useRaceStore = create<RaceState>()(
  subscribeWithSelector((set, get) => ({
    status: 'idle',
    countdown: 3,
    laps: 3,
    loop: true,
    checkpointCount: 0,
    currentLap: 1,
    nextCheckpoint: 1,
    elapsed: 0,
    lapElapsed: 0,
    lapTimes: [],
    bestLap: null,
    respawn: DEFAULT_SPAWN,
    spawn: DEFAULT_SPAWN,

    configureRace: ({ checkpointCount, laps, loop, spawn }) =>
      set({
        status: 'countdown',
        countdown: 3,
        checkpointCount,
        laps,
        loop,
        currentLap: 1,
        // On a loop the ship spawns just past checkpoint 0, so it's chasing #1 first.
        nextCheckpoint: 1 % Math.max(checkpointCount, 1),
        elapsed: 0,
        lapElapsed: 0,
        lapTimes: [],
        bestLap: null,
        respawn: spawn,
        spawn,
      }),

    tick: (dt) => {
      const s = get();
      if (s.status === 'countdown') {
        const next = s.countdown - dt;
        if (next <= 0) {
          set({ status: 'racing', countdown: 0 });
        } else {
          set({ countdown: next });
        }
        return;
      }
      if (s.status === 'racing') {
        set({ elapsed: s.elapsed + dt, lapElapsed: s.lapElapsed + dt });
      }
    },

    passCheckpoint: (index, transform) => {
      const s = get();
      if (s.status !== 'racing') return false;
      if (index !== s.nextCheckpoint) return false; // enforce in-order crossing

      const count = s.checkpointCount;
      const isFinishLine = s.loop ? index === 0 : index === count - 1;

      // Always update the respawn target to the checkpoint just cleared.
      const patch: Partial<RaceState> = { respawn: transform };

      if (isFinishLine) {
        const lapTimes = [...s.lapTimes, s.lapElapsed];
        const bestLap = s.bestLap === null ? s.lapElapsed : Math.min(s.bestLap, s.lapElapsed);
        const finishedLap = s.currentLap;

        if (finishedLap >= s.laps) {
          set({ ...patch, lapTimes, bestLap, status: 'finished', lapElapsed: 0 });
          return true;
        }
        set({
          ...patch,
          lapTimes,
          bestLap,
          currentLap: finishedLap + 1,
          lapElapsed: 0,
          nextCheckpoint: count > 1 ? 1 : 0,
        });
        return true;
      }

      set({ ...patch, nextCheckpoint: (index + 1) % count });
      return true;
    },

    resetRace: () =>
      set({
        status: 'countdown',
        countdown: 3,
        currentLap: 1,
        nextCheckpoint: get().checkpointCount > 1 ? 1 : 0,
        elapsed: 0,
        lapElapsed: 0,
        lapTimes: [],
        bestLap: null,
        respawn: get().spawn,
      }),
  }))
);

/** mm:ss.mmm formatter for lap/total times. */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}
