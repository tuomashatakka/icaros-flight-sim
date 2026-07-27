import type * as THREE from 'three'
import type { App, FrameContext } from 'threejs-scene'
import type { CameraRig } from '../camera/rig'
import type { SimClock } from '../clock'
import type { Controls } from '../input'
import type { LevelSpec } from '../levels/types'
import type { Physics } from '../physics/world'
import type { RaceState, ShipTuning } from '../state'
import type { Telemetry } from '../telemetry'
import type { VehicleHandle } from '../modules/vehicle'
import type { SunHandle } from '../modules/sun'
import type { PublishHandle } from '../modules/publish'


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
  rig:       CameraRig;
  level:     LevelSpec;
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

/** One row of a scenario trace. Short keys — a 30 s run is ~120 of these. */
export type ScenarioSample = {

  /** Sim seconds since the scenario started. */
  t: number;

  /** Position, rounded to mm. */
  p: [number, number, number];

  /** Heading in radians. */
  yaw: number;

  /** Speed, m/s. */
  v: number;

  /**
   * Dot of the ship's local up with world up. 1 = level, 0 = on its side,
   * -1 = inverted. The single number that answers "did it flip".
   */
  up: number;

  /** Wheels in contact this tick (0-4) mapped to a boolean by the vehicle. */
  grounded: boolean;
}

export type ScenarioEvent = {
  t:      number;
  type:   'crash' | 'gate' | 'lap' | 'finish' | 'respawn';
  index?: number;
}

export type ScenarioSummary = {
  maxSpeed: number;
  avgSpeed: number;
  minY:     number;
  maxY:     number;
  minUp:    number;

  /** Orientation failure: the ship spent {@link FLIP_PERSISTENCE} samples on its side or worse. */
  flipped: boolean;

  /**
   * Containment failure: the ship went below the track surface.
   *
   * Kept separate from {@link flipped} on purpose — they have different causes
   * (handling vs. collision) and conflating them makes "drove off a canyon
   * edge" indistinguishable from "the upright control stopped working".
   */
  fellThrough:   boolean;
  airborneRatio: number;
  crashes:       number;
  gatesPassed:   number;
  finished:      boolean;
  distance:      number;
}

export type ScenarioTrace = {
  name:    string;
  seed:    number;
  level:   string;
  ticks:   number;
  wallMs:  number;
  samples: ScenarioSample[];
  events:  ScenarioEvent[];
  summary: ScenarioSummary;
}

/** A timeline entry: at `at` sim seconds, merge `input` into the controls. */
export type ScenarioStep = {
  at:       number;
  input?:   Partial<Pick<Controls, 'steer' | 'throttle' | 'brake' | 'boost'>>;
  respawn?: boolean;
}

export type ScenarioScript = {
  name?:        string;
  level?:       string;
  seed?:        number;
  duration:     number;
  sampleEvery?: number;
  tuning?:      Partial<ShipTuning>;

  /** Optional starting pose — skipped entirely when absent. */
  start?: {
    position?: [number, number, number];
    yaw?:      number;
    linvel?:   [number, number, number];
  };

  /**
   * Neutral-input ticks run before the timeline, to wash out solver state left
   * by the live session. Defaults to 60. Lower it only if you are deliberately
   * testing behaviour from an unsettled state.
   */
  settleTicks?: number;

  /** Skip the 3-2-1 and go straight to `racing`. Defaults to true. */
  autoStart?: boolean;
  timeline:   ScenarioStep[];
}

export type OverlayFlags = {
  colliders?: boolean;
  wheels?:    boolean;
  contacts?:  boolean;
  path?:      boolean;
  frustum?:   boolean;
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
  version:      number;
  ready:        boolean;
  level:        string;
  seed:         number;
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
  scenario (script: ScenarioScript): Promise<ScenarioTrace>;
  overlay (flags: OverlayFlags): OverlayFlags;
  trace (): Record<string, unknown>;
  lastScenario: ScenarioTrace | null;

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
