/**
 * Server configuration, entirely from the environment.
 *
 * Every value has a localhost default so `bun run dev:server` works with no
 * setup, and nothing here is specific to a host or a cloud — the whole point of
 * running this as its own process is that it can be moved. The architecture
 * document is blunt about why it has to be one: an authoritative game server is
 * a persistent, stateful, in-memory simulation looping at 60 Hz, which is
 * exactly what a serverless platform cannot host.
 *
 * Which database to open is deliberately NOT here. `@crash-velocity/data`
 * reads that from the environment itself, because the other thing reading it is
 * a Next route handler on Vercel — and the two must resolve the same database
 * or a ticket minted by one means nothing to the other.
 */

export type ServerConfig = {
  host:     string;
  port:     number;
  devTools: boolean;

  /** Bots added to a race grid so a lobby of one is still a race. */
  raceGrid: number;
}

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

export function loadConfig (): ServerConfig {
  return {
    host:     process.env.HOST ?? '0.0.0.0',
    port:     int('PORT', 9003),
    devTools: flag('COLYSEUS_DEVTOOLS', process.env.NODE_ENV !== 'production'),
    raceGrid: int('RACE_GRID_BOTS', 4),
  }
}
