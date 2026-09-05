/**
 * Headless race replay — the determinism check race never had.
 *
 * Race used to prove reproducibility through `src/engine/dev/scenario.ts`: a
 * browser harness that drove the real app with rendering switched off, and
 * that had to explicitly reset six pieces of state before every run (body pose,
 * settle ticks, the race store, telemetry, a zone accumulator, two held axes).
 * Every one of those was found by diffing two runs that should have matched.
 *
 * This does not have that problem, because it builds a FRESH sim per run. The
 * reset nobody has to write is the one nobody can forget — so keep new sim
 * state constructor-initialised and this stays true.
 *
 * No wall clock appears anywhere below. `step(STEP)` in a plain loop is the
 * whole timing model, which is why ~12 sim seconds complete in tens of
 * milliseconds and two runs are byte-identical.
 */

import { STEP } from '@crash-velocity/physics/clock'

import { RaceSim } from '../sim'
import { trackBundle } from '../levels'
import { NEUTRAL_RACE_INPUT } from '../types'

import type { ShipId } from '@crash-velocity/physics/ships'
import type { TrackId } from '../levels'
import type { RaceEvent, RaceInput } from '../types'


export type ScriptedRacer = {
  name:    string;
  shipId?: ShipId;
  bot?:    boolean;

  /**
   * Optional start pose, overriding the grid slot.
   *
   * Isolation scripts need it: `turn-response` measures steering authority with
   * no throttle, and starting it wherever the grid happens to put it would mean
   * the number depends on which gate the grid is behind.
   */
  at?:  [number, number, number];
  yaw?: number;

  /** Initial linear velocity — the respawn script needs to arrive somewhere fast. */
  linvel?: [number, number, number];
}

/** An input change that takes effect at `tick` and holds until the next one. */
export type ScriptedRaceInput = {
  tick:  number;
  racer: number;
  input: Partial<RaceInput>;
}

export type RaceReplayScript = {
  name:   string;
  track:  TrackId;
  ticks:  number;
  racers: ScriptedRacer[];

  // Why the script is shaped this way. JSON has no comments and these outlive
  //  whoever wrote them.
  note?: string;

  /** Countdown seconds before the lights go out. 0 starts immediately. */
  countdown?: number;

  timeline: ScriptedRaceInput[];
}

export type ReplayRacerState = {
  id:       string;
  name:     string;
  position: number;
  lap:      number;
  gates:    number;
  bestLap:  number | null;
  finished: boolean;
  x:        number;
  y:        number;
  z:        number;
}

export type RaceReplaySummary = {
  name:        string;
  track:       string;
  ticks:       number;
  hash:        string;
  status:      string;
  eventCounts: Record<string, number>;
  racers:      ReplayRacerState[];
}

// Poses sampled every N ticks. Every tick would make the trace enormous for no
//  extra confidence — a divergence shows up within a few frames.
const SAMPLE_EVERY = 15

// Positions quantised to a millimetre before hashing, so the hash is a
//  statement about the simulation and not about float printing.
const QUANTUM = 1000

export async function replayRace (script: RaceReplayScript): Promise<RaceReplaySummary> {
  const { spec } = trackBundle(script.track)
  const sim      = await RaceSim.create(spec)

  const racers = script.racers.map(entry => {
    const racer = entry.bot ? sim.addBot(entry.shipId) : sim.addPlayer(entry.name, entry.shipId ?? 'icaras')

    if (entry.at) {
      racer.chassis.setTranslation({ x: entry.at[0], y: entry.at[1], z: entry.at[2] }, true)
      racer.previous = [ ...entry.at ]
      // The respawn target follows the placement, or the first time the ship
      // leaves the deck it teleports back to a grid slot the script never used.
      racer.progress.respawn = { position: entry.at, quaternion: racer.progress.respawn.quaternion }
    }

    if (entry.yaw !== undefined) {
      const half = entry.yaw / 2
      racer.chassis.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, true)
    }

    if (entry.linvel)
      racer.chassis.setLinvel({ x: entry.linvel[0], y: entry.linvel[1], z: entry.linvel[2] }, true)

    return racer
  })

  sim.start(script.countdown ?? 0)

  const held: RaceInput[] = racers.map(() => ({ ...NEUTRAL_RACE_INPUT }))
  const byTick            = new Map<number, ScriptedRaceInput[]>()
  for (const entry of script.timeline) {
    const list = byTick.get(entry.tick) ?? []
    list.push(entry)
    byTick.set(entry.tick, list)
  }

  const trace: number[]     = []
  const events: RaceEvent[] = []

  for (let tick = 0; tick < script.ticks; tick++) {
    for (const entry of byTick.get(tick) ?? []) {
      const racer = racers[entry.racer]
      if (!racer)
        continue

      held[entry.racer] = { ...held[entry.racer], ...entry.input }
      sim.setInput(racer.id, held[entry.racer])
    }

    // A scripted racer holds its input; a bot decides its own every tick.
    for (let i = 0; i < racers.length; i++)
      if (!racers[i].isBot)
        sim.setInput(racers[i].id, held[i])

    sim.step(STEP)
    events.push(...sim.drainEvents())

    if (tick % SAMPLE_EVERY === 0)
      for (const racer of racers) {
        const t = racer.chassis.translation()
        trace.push(Math.round(t.x * QUANTUM), Math.round(t.y * QUANTUM), Math.round(t.z * QUANTUM), racer.progress.gatesCleared)
      }
  }

  for (const event of events)
    trace.push(...quantiseEvent(event))

  const summary: RaceReplaySummary = {
    name:        script.name,
    track:       spec.id,
    ticks:       script.ticks,
    hash:        fnv1a(trace),
    status:      sim.status,
    eventCounts: count(events),
    racers:      racers.map(racer => {
      const t = racer.chassis.translation()
      return {
        id:       racer.id,
        name:     racer.name,
        position: racer.position,
        lap:      racer.progress.lap,
        gates:    racer.progress.gatesCleared,
        bestLap:  racer.progress.bestLap === null ? null : Math.round(racer.progress.bestLap * QUANTUM) / QUANTUM,
        finished: racer.progress.finished,
        x:        Math.round(t.x * QUANTUM) / QUANTUM,
        y:        Math.round(t.y * QUANTUM) / QUANTUM,
        z:        Math.round(t.z * QUANTUM) / QUANTUM,
      }
    }),
  }

  sim.dispose()
  return summary
}

function quantiseEvent (event: RaceEvent): number[] {
  const out = [ event.type.length ]
  for (const value of Object.values(event))
    out.push(typeof value === 'number' ? Math.round(value * QUANTUM) : String(value).length)
  return out
}

function count (events: readonly RaceEvent[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const event of events)
    out[event.type] = (out[event.type] ?? 0) + 1
  return out
}

function fnv1a (values: readonly number[]): string {
  let hash = 0x811c9dc5
  for (const value of values) {
    let rest = value | 0
    for (let byte = 0; byte < 4; byte++) {
      hash ^= rest & 0xff
      hash = Math.imul(hash, 0x01000193) >>> 0
      rest >>= 8
    }
  }
  return hash.toString(16).padStart(8, '0')
}
