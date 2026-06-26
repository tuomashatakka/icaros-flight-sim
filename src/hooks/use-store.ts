
"use client"
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

type SpeedLevel = {
  zone: number;
  speedTarget: number;
};

type State = {
  speed: number;
  setSpeed: (speed: number) => void;
  takedowns: number;
  addTakedown: () => void;
  zone: number;
  increaseZone: () => void;
  speedLevels: SpeedLevel[];
  boostMeter: number;
  setBoostMeter: (value: number) => void;
  crashFlash: number;
  triggerCrash: () => void;
};

const initialLevels: SpeedLevel[] = Array.from({ length: 10 }, (_, i) => ({
    zone: i + 1,
    speedTarget: 25 * (i + 2)
}));

export const useStore = create<State>()(
  subscribeWithSelector((set, get) => ({
    speed: 0,
    setSpeed: (speed) => set({ speed }),
    takedowns: 0,
    addTakedown: () => set((state) => ({ takedowns: state.takedowns + 1 })),
    boostMeter: 1,
    setBoostMeter: (value) => set({ boostMeter: Math.max(0, Math.min(1, value)) }),
    crashFlash: 0,
    triggerCrash: () => set((state) => ({ crashFlash: state.crashFlash + 1 })),
    zone: 1,
    increaseZone: () => {
      const currentZone = get().zone + 1;
      const currentSpeedLevels = get().speedLevels;
      // If the next zone doesn't exist yet, create it and the next few.
      if (!currentSpeedLevels.find(level => level.zone === currentZone)) {
        const newLevels = Array.from({ length: 5 }, (_, i) => {
          const newZone = currentSpeedLevels.length + i + 1;
          return {
            zone: newZone,
            speedTarget: 25 * (newZone + 1),
          };
        });
        set(state => ({
          speedLevels: [...state.speedLevels, ...newLevels],
        }));
      }
      set({ zone: currentZone });
    },
    speedLevels: initialLevels,
  }))
);
