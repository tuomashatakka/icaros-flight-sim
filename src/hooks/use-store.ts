"use client"
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

type State = {
  speed: number;
  setSpeed: (speed: number) => void;
  takedowns: number;
  addTakedown: () => void;
};

export const useStore = create<State>()(
  subscribeWithSelector((set) => ({
    speed: 0,
    setSpeed: (speed) => set({ speed }),
    takedowns: 0,
    addTakedown: () => set((state) => ({ takedowns: state.takedowns + 1 })),
  }))
);
