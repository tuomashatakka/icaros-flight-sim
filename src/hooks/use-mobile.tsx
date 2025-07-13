import { useEffect, useState } from 'react';

const keys = [
  { name: 'forward', keys: ['ArrowUp', 'w', 'W'] },
  { name: 'backward', keys: ['ArrowDown', 's', 'S'] },
  { name: 'left', keys: ['ArrowLeft', 'a', 'A'] },
  { name: 'right', keys: ['ArrowRight', 'd', 'D'] },
  { name: 'brake', keys: [' '] }, // Note: 'Space' is ' '
  { name: 'reset', keys: ['r', 'R'] },
];

export type Controls = {
  [key: string]: boolean;
};

export const useControls = (): Controls => {
  const [controls, setControls] = useState<Controls>({
    forward: false,
    backward: false,
    left: false,
    right: false,
    brake: false,
    reset: false,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keys.forEach((key) => {
        if (key.keys.includes(e.key)) {
          setControls((prev) => ({ ...prev, [key.name]: true }));
        }
      });
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keys.forEach((key) => {
        if (key.keys.includes(e.key)) {
          setControls((prev) => ({ ...prev, [key.name]: false }));
        }
      });
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  return controls;
};
