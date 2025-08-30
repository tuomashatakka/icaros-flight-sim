import { useEffect, useRef } from 'react';
import { create } from 'zustand';

// Keyboard controls mapping
const keys = [
  { name: 'steerLeft', keys: ['ArrowLeft', 'a', 'A'] },
  { name: 'steerRight', keys: ['ArrowRight', 'd', 'D'] },
  { name: 'boost', keys: ['Shift'] },
  { name: 'reset', keys: ['r', 'R'] },
];

export type Controls = {
  steer: number; // -1 for left, 1 for right, 0 for center
  boost: boolean;
  reset: boolean;
};

type ControlsState = {
  controls: Controls;
  setControls: (newControls: Partial<Controls>) => void;
  setSteer: (steer: number) => void;
};

const useControlsStore = create<ControlsState>((set) => ({
  controls: {
    steer: 0,
    boost: false,
    reset: false,
  },
  setControls: (newControls) =>
    set((state) => ({ controls: { ...state.controls, ...newControls } })),
  setSteer: (steer) =>
    set((state) => ({ controls: { ...state.controls, steer } })),
}));

export const useControls = () => {
  const { controls, setControls, setSteer } = useControlsStore();
  const steerDirection = useRef(0); // For keyboard, -1 left, 1 right

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
        steerDirection.current = -1;
      } else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
        steerDirection.current = 1;
      } else if (e.key === 'Shift') {
        setControls({ boost: true });
      } else if (e.key.toLowerCase() === 'r') {
        setControls({ reset: true });
      }
      setSteer(steerDirection.current);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if ((e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') && steerDirection.current === -1) {
        steerDirection.current = 0;
      } else if ((e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') && steerDirection.current === 1) {
        steerDirection.current = 0;
      } else if (e.key === 'Shift') {
        setControls({ boost: false });
      } else if (e.key.toLowerCase() === 'r') {
          setControls({ reset: false });
      }
      setSteer(steerDirection.current);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [setControls, setSteer]);
  
  // Touch controls
  useEffect(() => {
    let touchStart_X = 0;
    
    const handleTouchStart = (e: TouchEvent) => {
        touchStart_X = e.touches[0].clientX;
    };
    
    const handleTouchMove = (e: TouchEvent) => {
        const touch_X = e.touches[0].clientX;
        const deltaX = touch_X - touchStart_X;
        const screenWidth = window.innerWidth;
        // Normalize delta to a -1 to 1 range based on half screen width
        let steerValue = (deltaX / (screenWidth / 2)) * 2; 
        steerValue = Math.max(-1, Math.min(1, steerValue)); // Clamp between -1 and 1
        setSteer(steerValue);
    };

    const handleTouchEnd = (e: TouchEvent) => {
        setSteer(0);
        touchStart_X = 0;
    };

    window.addEventListener('touchstart', handleTouchStart);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleTouchEnd);

    return () => {
        window.removeEventListener('touchstart', handleTouchStart);
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
    }
  }, [setSteer]);

  return { controls, setControls };
};
