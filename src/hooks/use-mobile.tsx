import { useEffect, useState } from 'react';
import { create } from 'zustand';

const keys = [
  { name: 'forward', keys: ['ArrowUp', 'w', 'W'] },
  { name: 'left', keys: ['ArrowLeft', 'a', 'A'] },
  { name: 'right', keys: ['ArrowRight', 'd', 'D'] },
  { name: 'reset', keys: ['r', 'R'] },
];

export type Controls = {
  [key: string]: boolean;
};

type ControlsState = {
  controls: Controls;
  setControls: (newControls: Partial<Controls>) => void;
}

const useControlsStore = create<ControlsState>((set) => ({
  controls: {
    forward: true,
    left: false,
    right: false,
    reset: false,
  },
  setControls: (newControls) => set(state => ({ controls: { ...state.controls, ...newControls }})),
}));


export const useControls = () => {
    const { controls, setControls } = useControlsStore();

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            keys.forEach((key) => {
                if (key.keys.includes(e.key)) {
                    setControls({ [key.name]: true });
                }
            });
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            keys.forEach((key) => {
                if (key.keys.includes(e.key)) {
                    setControls({ [key.name]: false });
                }
            });
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [setControls]);

    return { controls, setControls };
}
