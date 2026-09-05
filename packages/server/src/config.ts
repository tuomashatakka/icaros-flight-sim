/**
 * Server configuration, entirely from the environment.
 *
 * Every value has a localhost default so `bun run dev:server` works with no
 * setup, and nothing here is specific to a host or a cloud — the whole point of
 * running this as its own process is that it can be moved.
 *
 * Which database to open is deliberately NOT here. `@crash-velocity/data`'s
 * `openStore` reads that from the environment itself, because the other thing
 * reading it is a Next route handler on Vercel, which has no `loadConfig()` —
 * and the two must resolve the same database or a token minted by one is
 * invisible to the other.
 */

import { STEP } from '@crash-velocity/physics/clock'


function int (name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '')
    return fallback

  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value))
    throw new Error(`${name} must be an integer, got ${JSON.stringify(raw)}`)
  return value
}

function flag (name: string, fallback = false): boolean {
  const raw = process.env[name]
  if (raw === undefined || raw === '')
    return fallback
  return raw === '1' || raw.toLowerCase() === 'true'
}

function list (name: string): string[] {
  const raw = process.env[name]
  if (!raw)
    return []
  return raw.split(',').map(s => s.trim())
    .filter(Boolean)
}

export type ServerConfig = {
  host: string;
  port: number;

  /**
   * Simulation rate. Defaults to 60 Hz to match `STEP`, which is simultaneously
   * the client's clock step, rapier's `world.timestep` and the `dt` that
   * `vehicleConfig` is tuned against — running the authority at any other rate
   * would change how every ship handles AND guarantee prediction divergence.
   */
  tickHz: number;

  /** Snapshot broadcast rate. 30 Hz = every 2nd tick. */
  snapshotHz: number;

  maxPlayers: number;

  /** Seconds a disconnected player's ship is held before it is removed. */
  reconnectGraceSec: number;

  /** Empty = allow any origin, which is what a local dev run wants. */
  originAllowlist: string[];

  /** Enables the `dev` message family used by `window.__devBattle`. */
  devCommands: boolean;
}

export function loadConfig (): ServerConfig {
  const tickHz     = int('TICK_HZ', Math.round(1 / STEP))
  const snapshotHz = int('SNAPSHOT_HZ', 30)

  if (tickHz % snapshotHz !== 0)
    // Broadcasting on a whole number of ticks keeps snapshot spacing even; an
    // uneven divisor makes the client's interpolation delay jitter by a tick
    // for no benefit.
    throw new Error(`SNAPSHOT_HZ (${snapshotHz}) must divide TICK_HZ (${tickHz}) evenly`)

  return {
    host:              process.env.HOST ?? '0.0.0.0',
    port:              int('PORT', 9003),
    tickHz,
    snapshotHz,
    maxPlayers:        int('MAX_PLAYERS', 16),
    reconnectGraceSec: int('RECONNECT_GRACE_SEC', 15),
    originAllowlist:   list('ORIGIN_ALLOWLIST'),
    devCommands:       flag('DEV_COMMANDS'),
  }
}

/** How many sim ticks pass between snapshot broadcasts. */
export function ticksPerSnapshot (config: ServerConfig): number {
  return Math.max(1, Math.round(config.tickHz / config.snapshotHz))
}
