import { useEffect, useRef } from 'react';
import { create } from 'zustand';

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

const clampSteer = (value: number) => Math.max(-1, Math.min(1, value));

export const useControls = (target?: HTMLElement | null) => {
  const { controls, setControls, setSteer } = useControlsStore();
  const pressedDirections = useRef(new Set<'left' | 'right'>());
  const keyboardSteer = useRef(0);
  const pointerSteer = useRef(0);

  const syncSteer = () => {
    setSteer(keyboardSteer.current || pointerSteer.current);
  };

  // Keyboard controls
  useEffect(() => {
    const refreshKeyboardSteer = () => {
      const left = pressedDirections.current.has('left');
      const right = pressedDirections.current.has('right');
      keyboardSteer.current = left === right ? 0 : right ? 1 : -1;
      syncSteer();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
        pressedDirections.current.add('left');
        refreshKeyboardSteer();
      } else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
        pressedDirections.current.add('right');
        refreshKeyboardSteer();
      } else if (e.key === 'Shift') {
        setControls({ boost: true });
      } else if (e.key.toLowerCase() === 'r') {
        setControls({ reset: true });
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') {
        pressedDirections.current.delete('left');
        refreshKeyboardSteer();
      } else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') {
        pressedDirections.current.delete('right');
        refreshKeyboardSteer();
      } else if (e.key === 'Shift') {
        setControls({ boost: false });
      } else if (e.key.toLowerCase() === 'r') {
        setControls({ reset: false });
      }
    };

    const handleBlur = () => {
      pressedDirections.current.clear();
      keyboardSteer.current = 0;
      pointerSteer.current = 0;
      setControls({ boost: false, reset: false });
      setSteer(0);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [setControls, setSteer]);
  
  useEffect(() => {
    if (!target) return;

    let pointerId: number | null = null;
    let pointerStartX = 0;

    const handlePointerDown = (e: PointerEvent) => {
      if (pointerId !== null) return;
      pointerId = e.pointerId;
      pointerStartX = e.clientX;
      pointerSteer.current = 0;
      target.setPointerCapture(e.pointerId);
      syncSteer();
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      const steeringWidth = Math.max(target.clientWidth * 0.32, 120);
      pointerSteer.current = clampSteer((e.clientX - pointerStartX) / steeringWidth);
      syncSteer();
    };

    const endPointer = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
      pointerId = null;
      pointerSteer.current = 0;
      syncSteer();
    };

    target.addEventListener('pointerdown', handlePointerDown);
    target.addEventListener('pointermove', handlePointerMove);
    target.addEventListener('pointerup', endPointer);
    target.addEventListener('pointercancel', endPointer);

    return () => {
      target.removeEventListener('pointerdown', handlePointerDown);
      target.removeEventListener('pointermove', handlePointerMove);
      target.removeEventListener('pointerup', endPointer);
      target.removeEventListener('pointercancel', endPointer);
    };
  }, [setSteer, target]);

  return { controls, setControls };
};
