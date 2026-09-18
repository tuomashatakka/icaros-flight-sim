/**
 * The half of battle's state that Colyseus synchronises.
 *
 * Two channels carry a match, and the split is deliberate:
 *
 * - **This file** — roster, score, status, objectives. Low frequency, variably
 *   shaped, and exactly what `@colyseus/schema`'s delta encoder is good at. It
 *   patches at 20 Hz and a late joiner gets the whole thing for free.
 * - **`@crash-velocity/net`'s bit-packed snapshot** — pose, velocity, health,
 *   flags, aim. Thirty times a second, every ship, and the place where
 *   smallest-three quaternions and quantised positions earn their keep. Schema
 *   would encode those as full float64s.
 *
 * Running both is not redundancy: Schema cannot quantise, and a hand-rolled
 * codec has no business re-implementing map deltas and late-join replay.
 *
 * `netIndex` is the join between them — the uint16 a ship is known by on the
 * binary channel. Without it a client could not tell which decoded transform
 * belongs to which roster entry.
 */

import { schema, t } from '@colyseus/schema'
import { WEAPONS } from './weapons'

import type { SchemaType } from '@colyseus/schema'
import type { BattleSim } from './sim'


export const PlayerState = schema({
  id:     t.string(),
  name:   t.string(),
  team:   t.string(),
  shipId: t.string(),
  isBot:  t.boolean().default(false),

  /** The id this ship carries in the bit-packed snapshot. */
  netIndex: t.uint16().default(0),

  health:    t.uint8().default(100),
  maxHealth: t.uint8().default(100),

  // The boost meter, 0..255 for 0..1. A byte at 20 Hz, and it has to be on
  //  this channel rather than the binary one: that record's `health` field is
  //  already spoken for, and a HUD meter is not worth forking the codec over.
  boost:  t.uint8().default(255),
  kills:  t.uint16().default(0),
  deaths: t.uint16().default(0),

  /** Team whose objective this pilot is carrying, or ''. */
  carrying: t.string().default(''),

  // These change every tick while a reticle is settling. They were briefly
  // marked `.unreliable()` — the document's channel split, and Colyseus 0.18
  // supports the marker — but an unreliable field over a WEBSOCKET transport is
  // never patched at all, which the server says out loud at boot. The lane only
  // exists on `@colyseus/h3-transport` (WebTransport). Until that swap, these
  // ride the ordered channel like everything else; the genuinely hot values
  // are on the binary snapshot, which supersedes stale data by tick anyway.
  lockPhase:   t.string().default('idle'),
  lockTarget:  t.string().default(''),
  lockMeter:   t.number().default(0),
  primaryCd:   t.number().default(0),
  secondaryCd: t.number().default(0),
}, 'BattlePlayerState')

export const ZoneState = schema({
  id:        t.string(),
  owner:     t.string().default(''),
  progress:  t.number().default(0),
  capturing: t.string().default(''),
  contested: t.boolean().default(false),
}, 'BattleZoneState')

export const FlagState = schema({
  team:      t.string(),
  state:     t.string().default('home'),
  carrierId: t.string().default(''),
  x:         t.number().default(0),
  y:         t.number().default(0),
  z:         t.number().default(0),
}, 'BattleFlagState')

export const BattleState = schema({
  arenaId:   t.string().default('apex'),
  status:    t.string().default('lobby'),
  countdown: t.number().default(0),
  timeLeft:  t.number().default(0),
  scoreRed:  t.uint16().default(0),
  scoreBlue: t.uint16().default(0),

  /** Authoritative tick, so a late joiner can seed its clock before the first snapshot. */
  serverTick: t.uint32().default(0),

  players: t.map(PlayerState),
  zones:   t.map(ZoneState),
  flags:   t.map(FlagState),
}, 'BattleState')

export type PlayerStateType = SchemaType<typeof PlayerState>
export type BattleStateType = SchemaType<typeof BattleState>

/**
 * Mirror the sim's live state into the synchronised state.
 *
 * Only the slow half; poses never touch this. Writes are guarded by an equality
 * check because assigning an unchanged value still marks the field dirty, and a
 * roster of sixteen ships would otherwise re-encode itself every patch.
 *
 * Reads `sim` directly rather than a `BattleSnapshot` — every field below is
 * already a plain scalar on `BattleSim`/`BattlePlayer`/`BattleZone`/
 * `BattleFlag`, so building the whole snapshot tree first (`sim.snapshot()`,
 * which also computes pose and velocity — neither of which this sync touches)
 * would be an allocation this 30-Hz-adjacent path has no use for. `tick` is
 * still taken as a parameter: it is the ROOM's own counter (`this.tickNo`),
 * not the sim's — see `battleSnapshotOf`, which takes it the same way.
 * `snapshot()` stays the right call for `recordResult` and anywhere else that
 * wants the full tree.
 */
export function syncBattleState (
  state: BattleStateType,
  sim: BattleSim,
  tick: number,
  netIndexOf: (playerId: string) => number,
): void {
  set(state, 'status', sim.status)
  set(state, 'countdown', round(Math.max(0, Math.ceil(sim.countdown))))
  set(state, 'timeLeft', round(Math.max(0, sim.config.matchTime - sim.elapsed)))
  set(state, 'scoreRed', sim.scores.red)
  set(state, 'scoreBlue', sim.scores.blue)
  set(state, 'serverTick', tick)

  const seen = new Set<string>()

  for (const player of sim.players) {
    seen.add(player.id)

    let entry = state.players.get(player.id)
    if (!entry) {
      entry = new PlayerState({ id: player.id, name: player.name, team: player.team, shipId: player.shipId })
      state.players.set(player.id, entry)
    }

    set(entry, 'netIndex', netIndexOf(player.id))
    set(entry, 'health', Math.max(0, Math.min(255, Math.round(player.health))))
    set(entry, 'maxHealth', Math.max(0, Math.min(255, Math.round(player.maxHealth))))
    set(entry, 'boost', Math.max(0, Math.min(255, Math.round(player.boostMeter * 255))))
    set(entry, 'kills', player.kills)
    set(entry, 'deaths', player.deaths)
    set(entry, 'lockPhase', player.lock.phase)
    set(entry, 'lockTarget', player.lock.targetId ?? '')
    set(entry, 'lockMeter', round(player.lock.progress))
    set(entry, 'primaryCd', round(player.cooldown.primary / WEAPONS[player.loadout.primary].cooldown))
    set(entry, 'secondaryCd', round(player.cooldown.secondary / WEAPONS[player.loadout.secondary].cooldown))
  }

  for (const id of [ ...state.players.keys() ])
    if (!seen.has(id))
      state.players.delete(id)

  for (const zone of sim.zones) {
    let entry = state.zones.get(zone.def.id)
    if (!entry) {
      entry = new ZoneState({ id: zone.def.id })
      state.zones.set(zone.def.id, entry)
    }
    set(entry, 'owner', zone.owner ?? '')
    set(entry, 'progress', round(zone.progress))
    set(entry, 'capturing', zone.capturing ?? '')
    set(entry, 'contested', zone.contested)
  }

  for (const flag of sim.flags) {
    let entry = state.flags.get(flag.team)
    if (!entry) {
      entry = new FlagState({ team: flag.team })
      state.flags.set(flag.team, entry)
    }
    set(entry, 'state', flag.state)
    set(entry, 'carrierId', flag.carrierId ?? '')
    set(entry, 'x', round(flag.position[0]))
    set(entry, 'y', round(flag.position[1]))
    set(entry, 'z', round(flag.position[2]))
  }

  // The objective a pilot carries is on the flag, but the HUD asks the pilot —
  //  resolving it here keeps that lookup off the render path.
  for (const [ id, entry ] of state.players)
    set(entry, 'carrying', [ ...state.flags.values() ].find(f => f.carrierId === id)?.team ?? '')
}

// Millimetre / millisecond precision. Finer than anything drawn, and it stops
//  float noise from marking a field dirty on every single patch.
function round (value: number): number {
  return Math.round(value * 1000) / 1000
}

function set<T extends object, K extends keyof T> (target: T, key: K, value: T[K]): void {
  if (target[key] !== value)
    target[key] = value
}
