import type * as THREE from 'three'
import type { App, FrameContext } from 'threejs-scene'
import type { CameraRig } from '../camera/rig'
import type { SimClock } from 'Φclock'
import type { Controls } from '../input'
import type { TrackSpec } from 'Λ'
import type { Physics } from 'Φworld'
import type { RaceState, ShipTuning } from 'Ƨ'
import type { Telemetry } from '../telemetry'
import type { VehicleHandle } from '../vehicle'
import type { SunHandle } from '../modules/sun'
import type { PublishHandle } from '../modules/publish'
import type { RendererQuality } from '../quality/runtime'


/**
 * Everything the harness borrows from the composition root.
 *
 * All of it already exists in `mountRace`'s scope — the dev layer reads these
 * handles and never constructs sim state of its own, so nothing here can change
 * how the game behaves when the harness is absent (i.e. in production).
 */
export type DevDeps = {
  app:       App<RaceState>;
  physics:   Physics;
  clock:     SimClock;
  controls:  Controls;
  telemetry: Telemetry;
  vehicle:   { current: VehicleHandle | null };
  sun:       { current: SunHandle | null };
  publish:   { current: PublishHandle | null };
  quality:   RendererQuality;
  rig:       CameraRig;
  level:     TrackSpec;
  seed:      number;
  levelId:   string;

  /**
   * Turns the root render override into a no-op. THE turbo switch: physics at
   * 1/60 is cheap, the composer is not, so a scenario that skips rendering runs
   * a few hundred times faster than real time.
   */
  setSkipRender (skip: boolean): void;

  /** Draw one frame on demand, bypassing the skip flag (step, screenshots). */
  renderOnce (frame?: Partial<FrameContext>): void;
}


export type ScenarioEvent = {
  t:      number;
  type:   'crash' | 'gate' | 'lap' | 'finish' | 'respawn';
  index?: number;
}


/** A timeline entry: at `at` sim seconds, merge `input` into the controls. */
export type ScenarioStep = {
  at:       number;
  input?:   Partial<Pick<Controls, 'steer' | 'strafe' | 'throttle' | 'brake' | 'boost' | 'pitch'>>;
  respawn?: boolean;
}


export type OverlayFlags = {
  colliders?: boolean;
  contacts?:  boolean;
  path?:      boolean;
  frustum?:   boolean;

  // --- physics layers -----------------------------------------------------
  /** The four hover rays, their hit points and the surface normals. */
  rays?: boolean;

  /** One arrow per applied force, at its application point, coloured by system. */
  forces?: boolean;

  /** The sum: net force (white) and net torque (red) from the centre of mass. */
  netForce?: boolean;

  /** Static rig markers — every nozzle mount and direction, firing or not. */
  thrusters?: boolean;

  /** Centre of mass and the body axis triad. */
  com?: boolean;

  /** Linear and angular velocity vectors. */
  velocity?: boolean;

  /** Inertia ellipsoid — the other half of `tau = I * alpha`. */
  inertia?: boolean;
}

export type TeleportArgs = {
  position?:   [number, number, number];
  yaw?:        number;
  quaternion?: [number, number, number, number];
  linvel?:     [number, number, number];
  angvel?:     [number, number, number];
}

/** Rolling per-frame record kept by the trace buffer. */
export type FrameRecord = {
  ms:        number;
  speed:     number;
  grounded:  boolean;
  drawCalls: number;
}

export type CapturedLog = {
  t:     number;
  level: 'error' | 'warn' | 'log';
  text:  string;
}

/** The shape installed at `window.__dev`. Everything returns plain JSON. */
export type DevApi = {
  version: number;
  ready:   boolean;
  level:   string;
  seed:    number;
  probe (): Record<string, unknown>;
  pause (): { paused: boolean };
  resume (): { paused: boolean };
  step (n?: number): Record<string, unknown>;
  snapCamera (): { view: string; blend: number };
  teleport (args: TeleportArgs): Record<string, unknown>;
  setInput (patch: Partial<Controls>): Partial<Controls>;
  respawn (): void;
  toggleView (): string;
  setTuning (patch: Partial<ShipTuning>): ShipTuning;
  resetTuning (): ShipTuning;
  setStatus (status: RaceState['status']): string;
  overlay (flags: OverlayFlags): OverlayFlags;
  trace (): Record<string, unknown>;
  quality (): ReturnType<RendererQuality['snapshot']>;
  setQuality (preference: import('../quality/controller').QualityPreference): ReturnType<RendererQuality['snapshot']>;

  /** Raw handles — the escape hatch for `dev-cli eval`. Not JSON-safe. */
  raw: DevDeps;
}

declare global {
  interface Window {
    __dev?:   DevApi;
    __race?:  unknown;
    __three?: typeof THREE;
  }
}
