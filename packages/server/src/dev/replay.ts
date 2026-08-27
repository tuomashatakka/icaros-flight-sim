/**
 * Headless match replay — battle's answer to `runScenario`.
 *
 * `src/engine/dev/scenario.ts` cannot cover battle: it reads `useRaceStore`
 * throughout and `deps.level` is undefined for this mode. But battle needs the
 * same guarantee, and needs it more, because the client now PREDICTS this
 * simulation — if the server is not reproducible from an input stream, no
 * amount of reconciliation keeps the two in step.
 *
 * So: build a sim, feed it a scripted input timeline with no wall clock at all,
 * and hash the result. Two runs of one script must produce the same hash. A
 * difference is a determinism bug, and per AGENTS.md that is the thing to
 * investigate before anything else.
 *
 * **Adding sim state that persists across ticks? It has to be constructor-
 * initialised, or scripts silently stop being reproducible.** That is why this
 * builds a fresh sim per run instead of resetting a shared one: the reset that
 * cannot be forgotten is the one nobody has to write.
 */

import { BattleSim } from 'Δengine/battle/sim'
import { apexArena } from 'Δengine/battle/arena'
import { STEP } from 'Δengine/clock'
import type { BattleTeam } from 'Δengine/battle/arena'
import type { BattleEvent, BattleInput } from 'Δengine/battle/types'
import type { Loadout } from 'Δengine/battle/weapons'
import type { ShipId } from 'Δlib/ship/registry'


export type ScriptedPlayer = {
  name:     string;
  team:     BattleTeam;
  shipId?:  ShipId;
  loadout?: Loadout;

  /**
   * Optional start pose, mirroring `ScenarioScript.start` in the race harness.
   *
   * Without it a script can only test flying, because two ships on their own
   * team's spawn lanes never come within weapon range in the ticks a test wants
   * to run. `yaw` faces the ship, so a script can point one at the other and
   * exercise lock, beam and damage deterministically.
   */
  at?:  [number, number, number];
  yaw?: number;
}

/** An input change that takes effect at `tick` and holds until the next one. */
export type ScriptedInput = {
  tick:   number;
  player: number;
  input:  Partial<BattleInput>;
}

export type ReplayScript = {
  name:    string;
  ticks:   number;
  players: ScriptedPlayer[];

  // Why this script is shaped the way it is. JSON has no comments and these
  //  coordinates are not obvious — see `point-blank.json` for the reason.
  note?: string;

  /** Added AFTER the scripted players, so scripted ids stay stable. */
  bots?: number;

  timeline: ScriptedInput[];
}

export type ReplayPlayerState = {
  id:     string;
  team:   BattleTeam;
  health: number;
  kills:  number;
  deaths: number;
  x:      number;
  y:      number;
  z:      number;
}

export type ReplaySummary = {
  name:  string;
  ticks: number;

  /** The whole point: identical across runs, or determinism is broken. */
  hash: string;

  status:      string;
  scores:      Record<string, number>;
  eventCounts: Record<string, number>;
  players:     ReplayPlayerState[];
}

const NEUTRAL: BattleInput = {
  steer:         0,
  throttle:      false,
  brake:         false,
  boost:         false,
  fire:          false,
  fireSecondary: false,
  reverse:       false,
  strafe:        0,
  aimPitch:      0,
  resetSeq:      0,
}

/**
 * Positions quantise to a millimetre before hashing.
 *
 * Not to hide drift — a real divergence moves a ship far further than that
 * within a few ticks — but so the hash answers "did the sim take the same
 * path" instead of failing on the last bit of a float no gameplay depends on.
 */
const QUANTUM = 1000

// Poses are sampled, not hashed every tick: divergence propagates in a few
//  ticks anyway, and the full trace is an order of magnitude larger.
const SAMPLE_EVERY = 15

function fnv1a (input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const q = (value: number) => Math.round(value * QUANTUM) / QUANTUM

/** Events carry floats in some payloads, so numbers quantise like poses do. */
function traceOf (tick: number, event: BattleEvent): string {
  const parts: string[] = [ String(tick), event.type ]
  for (const [ key, value ] of Object.entries(event))
    if (key === 'type')
      continue
    else
      parts.push(`${key}=${typeof value === 'number' ? q(value) : String(value)}`)
  return parts.join('|')
}

/** Build the sim a script describes: scripted players first, then bots. */
async function buildSim (script: ReplayScript): Promise<BattleSim> {
  const sim = await BattleSim.create(apexArena())

  for (const spec of script.players) {
    const player = sim.addPlayer(spec.name, spec.team, spec.shipId ?? 'icaras', spec.loadout)
    if (spec.at)
      player.chassis.setTranslation({ x: spec.at[0], y: spec.at[1], z: spec.at[2] }, true)
    if (spec.yaw !== undefined)
      player.chassis.setRotation({ x: 0, y: Math.sin(spec.yaw / 2), z: 0, w: Math.cos(spec.yaw / 2) }, true)
  }

  for (let i = 0; i < (script.bots ?? 0); i++)
    sim.addBot(i % 2 === 0 ? 'blue' : 'red')

  // No countdown: a script counts ticks, and burning the first 180 on a timer
  // nobody watches only makes every script longer.
  sim.start(0)
  return sim
}

// Bucket the timeline by tick, so the hot loop is a lookup rather than a scan
//  and an out-of-order script still behaves.
function bucketTimeline (timeline: ScriptedInput[]): Map<number, ScriptedInput[]> {
  const byTick = new Map<number, ScriptedInput[]>()
  for (const entry of timeline) {
    const bucket = byTick.get(entry.tick)
    if (bucket)
      bucket.push(entry)
    else
      byTick.set(entry.tick, [ entry ])
  }
  return byTick
}

export async function replayMatch (script: ReplayScript): Promise<ReplaySummary> {
  const sim    = await buildSim(script)
  const byTick = bucketTimeline(script.timeline)

  const held: BattleInput[] = script.players.map(() => ({ ...NEUTRAL }))

  const eventCounts: Record<string, number> = {}
  const trace: string[]                     = []

  for (let tick = 0; tick < script.ticks; tick++) {
    for (const entry of byTick.get(tick) ?? [])
      if (held[entry.player])
        held[entry.player] = { ...held[entry.player], ...entry.input }

    script.players.forEach((_, index) => {
      const player = sim.players[index]
      if (player)
        sim.setInput(player.id, held[index])
    })

    sim.step(STEP)

    for (const event of sim.drainEvents()) {
      eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1
      trace.push(traceOf(tick, event))
    }

    if (tick % SAMPLE_EVERY === 0)
      for (const player of sim.players) {
        const t = player.chassis.translation()
        trace.push(`${tick}|${player.id}|${q(t.x)},${q(t.y)},${q(t.z)}|${player.health}`)
      }
  }

  const summary: ReplaySummary = {
    name:    script.name,
    ticks:   script.ticks,
    hash:    fnv1a(trace.join('\n')),
    status:  sim.status,
    scores:  { ...sim.scores },
    eventCounts,
    players: sim.players.map(player => {
      const t = player.chassis.translation()
      return {
        id:     player.id,
        team:   player.team,
        health: player.health,
        kills:  player.kills,
        deaths: player.deaths,
        x:      q(t.x),
        y:      q(t.y),
        z:      q(t.z),
      }
    }),
  }

  sim.dispose()
  return summary
}
