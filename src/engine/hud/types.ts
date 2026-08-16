import type * as THREE from 'three'
import type { Telemetry } from '../telemetry'

/** Race readouts, sampled imperatively once per frame — never subscribed to. */
export type HudRace = {
  status:     string;
  currentLap: number;
  laps:       number;
  loop:       boolean;
  elapsed:    number;
  lapElapsed: number;
  bestLap:    number | null;
}

/**
 * Everything the HUD needs for one rendered frame.
 *
 * Assembled by the caller in the render phase and passed down, so no HUD part
 * reaches into a store or the physics world on its own.
 */
export type HudFrame = {

  /** Real seconds since start — drives shader time, not the sim. */
  elapsed: number;

  telemetry: Telemetry;
  race:      HudRace;

  /** Interpolated hull pose for this frame. */
  shipPosition:   THREE.Vector3;
  hullQuaternion: THREE.Quaternion;

  /** Throttle input, 0..1, for the thrust bar. */
  throttle: number;

  /** World position of the next checkpoint, or null. */
  gate: THREE.Vector3 | null;

  /** 0 = chase, 1 = cockpit. Cross-fades the two HUD sets. */
  blend: number;

  camera: THREE.Camera;

  /** Pointer look-around, -1..1 on each axis. Drives parallax + focal DOF. */
  panX: number;
  panY: number;
}

/** Reference top speed the gauges normalise against, m/s. */
export const SPEED_SCALE = 80
