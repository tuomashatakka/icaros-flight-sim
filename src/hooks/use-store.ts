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
};

const levels: SpeedLevel[] = Array.from({ length: 20 }, (_, i) => ({
    zone: i + 1,
    speedTarget: 25 * (i + 2)
}));

export const useStore = create<State>()(
  subscribeWithSelector((set) => ({
    speed: 0,
    setSpeed: (speed) => set({ speed }),
    takedowns: 0,
    addTakedown: () => set((state) => ({ takedowns: state.takedowns + 1 })),
    zone: 1,
    increaseZone: () => set((state) => ({ zone: state.zone + 1 })),
    speedLevels: levels,
  }))
);
