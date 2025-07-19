"use client"
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

type State = {
  speed: number;
  setSpeed: (speed: number) => void;
};

export const useStore = create<State>()(
  subscribeWithSelector((set) => ({
    speed: 0,
    setSpeed: (speed) => set({ speed }),
  }))
);