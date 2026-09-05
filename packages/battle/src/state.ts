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

import type { SchemaType } from '@colyseus/schema'
import type { BattleSnapshot } from './types'


export const PlayerState = schema({
  id:        t.string(),
  name:      t.string(),
  team:      t.string(),
  shipId:    t.string(),
  isBot:     t.boolean().default(false),

  /** The id this ship carries in the bit-packed snapshot. */
  netIndex:  t.uint16().default(0),

  health:    t.uint8().default(100),
  maxHealth: t.uint8().default(100),
  kills:     t.uint16().default(0),
  deaths:    t.uint16().default(0),

  /** Team whose objective this pilot is carrying, or ''. */
  carrying:  t.string().default(''),

  // Lock state changes every tick while a reticle is settling, so it is marked
  // unreliable: a dropped update costs one stale meter reading rather than
  // stalling the ordered stream behind a retransmit.
  lockPhase:  t.string().default('idle').unreliable(),
  lockTarget: t.string().default('').unreliable(),
  lockMeter:  t.number().default(0).unreliable(),
  primaryCd:  t.number().default(0).unreliable(),
  secondaryCd: t.number().default(0).unreliable(),
}, 'BattlePlayerState')

export const ZoneState = schema({
  id:        t.string(),
  owner:     t.string().default(''),
  progress:  t.number().default(0).unreliable(),
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
 * Mirror a sim snapshot into the synchronised state.
 *
 * Only the slow half; poses never touch this. Writes are guarded by an equality
 * check because assigning an unchanged value still marks the field dirty, and a
 * roster of sixteen ships would otherwise re-encode itself every patch.
 */
export function syncBattleState (
  state: BattleStateType,
  snapshot: BattleSnapshot,
  netIndexOf: (playerId: string) => number,
): void {
  set(state, 'status', snapshot.status)
  set(state, 'countdown', round(snapshot.countdown))
  set(state, 'timeLeft', round(snapshot.timeLeft))
  set(state, 'scoreRed', snapshot.scores.red)
  set(state, 'scoreBlue', snapshot.scores.blue)
  set(state, 'serverTick', snapshot.tick)

  const seen = new Set<string>()

  for (const player of snapshot.players) {
    seen.add(player.id)

    let entry = state.players.get(player.id)
    if (!entry) {
      entry = new PlayerState({ id: player.id, name: player.name, team: player.team, shipId: player.shipId })
      state.players.set(player.id, entry)
    }

    set(entry, 'netIndex', netIndexOf(player.id))
    set(entry, 'health', Math.max(0, Math.min(255, Math.round(player.health))))
    set(entry, 'maxHealth', Math.max(0, Math.min(255, Math.round(player.maxHealth))))
    set(entry, 'kills', player.kills)
    set(entry, 'deaths', player.deaths)
    set(entry, 'lockPhase', player.lockPhase)
    set(entry, 'lockTarget', player.lockTarget ?? '')
    set(entry, 'lockMeter', round(player.lockMeter))
    set(entry, 'primaryCd', round(player.primaryCd))
    set(entry, 'secondaryCd', round(player.secondaryCd))
  }

  for (const id of [ ...state.players.keys() ])
    if (!seen.has(id))
      state.players.delete(id)

  for (const zone of snapshot.zones) {
    let entry = state.zones.get(zone.id)
    if (!entry) {
      entry = new ZoneState({ id: zone.id })
      state.zones.set(zone.id, entry)
    }
    set(entry, 'owner', zone.owner ?? '')
    set(entry, 'progress', round(zone.progress))
    set(entry, 'capturing', zone.capturing ?? '')
    set(entry, 'contested', zone.contested)
  }

  for (const flag of snapshot.flags) {
    let entry = state.flags.get(flag.team)
    if (!entry) {
      entry = new FlagState({ team: flag.team })
      state.flags.set(flag.team, entry)
    }
    set(entry, 'state', flag.state)
    set(entry, 'carrierId', flag.carrierId ?? '')
    set(entry, 'x', round(flag.x))
    set(entry, 'y', round(flag.y))
    set(entry, 'z', round(flag.z))
  }

  // The objective a pilot carries is on the flag, but the HUD asks the pilot —
  //  resolving it here keeps that lookup off the render path.
  for (const [ id, entry ] of state.players)
    set(entry, 'carrying', [ ...state.flags.values() ].find(f => f.carrierId === id)?.team ?? '')
}

/** Millimetre / millisecond precision. Finer than anything drawn, and it stops
 *  float noise from marking a field dirty on every single patch. */
function round (value: number): number {
  return Math.round(value * 1000) / 1000
}

function set<T extends object, K extends keyof T> (target: T, key: K, value: T[K]): void {
  if (target[key] !== value)
    target[key] = value
}
