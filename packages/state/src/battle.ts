import { defineStore } from './store'
import { INITIAL_BATTLE, KILL_FEED_CAP, TOAST_CAP } from './defaults'
import type {
  BattleChrome, BattleEvent, BattleJoin, BattlePilot, BattleRosterEntry, BattleSessionState,
  BattleSessionStatus, KillFeedEntry, LockOnState, NetHealth, WeaponView,
} from './types'


export const battleStore = defineStore<BattleSessionState>(INITIAL_BATTLE)

let toastSeq = 0

const toast = (list: string[], text: string): string[] =>
  [ `${toastSeq++}|${text}`, ...list ].slice(0, TOAST_CAP)

/** Quantised so a value that only wiggles in the noise cannot force a commit. */
const q = (v: number, steps = 100) => Math.round(v * steps) / steps

export const battleActions = {
  setStatus: (status: BattleSessionStatus) => battleStore.set({ status }),
  setError:  (error: string) => battleStore.set({ status: 'error', error }),

  joined: ({ playerId, team, shipId, name }: BattleJoin) =>
    battleStore.set({ playerId, myTeam: team, myShip: shipId, myName: name, status: 'queued' }),

  // The meter ticks 60×/s; only commit when it moves a visible amount.
  setLockOn: (next: LockOnState) => battleStore.update(state => {
    const prev = state.lockOn
    const same = prev.phase === next.phase &&
      prev.targetId === next.targetId &&
      Math.abs(prev.progress - next.progress) < 0.02 &&
      Math.abs(prev.distance - next.distance) < 2
    return same ? state : { lockOn: { ...next, progress: q(next.progress, 50), distance: Math.round(next.distance) }}
  }),

  // Quantised for the same reason the lock meter is: the trim integrates every
  // tick, and a React commit per 0.6 mrad of aim is 60 renders a second.
  setAimPitch: (aim: number) => battleStore.update(state => {
    const next = q(aim, 100)
    return next === state.aimPitch ? state : { aimPitch: next }
  }),

  setWeapons: (primary: WeaponView, secondary: WeaponView) => battleStore.update(state => {
    const same = state.primary?.id === primary.id &&
      state.secondary?.id === secondary.id &&
      Math.abs((state.primary?.cooldown ?? 0) - primary.cooldown) < 0.05 &&
      Math.abs((state.secondary?.cooldown ?? 0) - secondary.cooldown) < 0.05
    return same
      ? state
      : {
        primary:   { ...primary, cooldown: q(primary.cooldown, 20) },
        secondary: { ...secondary, cooldown: q(secondary.cooldown, 20) },
      }
  }),

  setPilot: ({ health, maxHealth, boost, kills, deaths, carrying }: BattlePilot) => battleStore.update(state => {
    const same = state.myHealth === health &&
      state.maxHealth === maxHealth &&
      state.myKills === kills &&
      state.myDeaths === deaths &&
      state.carrying === carrying &&
      Math.abs(state.myBoost - boost) < 0.02
    return same
      ? state
      : { myHealth: health, maxHealth, myBoost: q(boost, 50), myKills: kills, myDeaths: deaths, carrying }
  }),

  // Only replace when membership or a score actually changed, so the HUD is
  // not re-rendered every packet.
  setRoster: (roster: BattleRosterEntry[]) => battleStore.update(state => {
    const same = state.roster.length === roster.length &&
      state.roster.every((r, i) =>
        r.id === roster[i].id &&
        r.team === roster[i].team &&
        r.isBot === roster[i].isBot &&
        r.kills === roster[i].kills &&
        r.deaths === roster[i].deaths)
    return same ? state : { roster }
  }),

  setChrome: ({ status, countdown, timeLeft, scores, scoreTarget, zones, flags }: BattleChrome) => battleStore.update(state => {
    const zoneSame = zones.length === state.zones.length &&
      zones.every((z, i) => {
        const prev = state.zones[i]
        return z.owner === prev.owner &&
          z.id === prev.id &&
          z.capturing === prev.capturing &&
          z.contested === prev.contested &&
          Math.abs(z.progress - prev.progress) < 0.02
      })
    const flagSame = flags.length === state.flags.length &&
      flags.every((f, i) => f.team === state.flags[i].team && f.state === state.flags[i].state)
    const chromeSame = state.status === status &&
      state.countdown === countdown &&
      state.timeLeft === timeLeft &&
      state.scores.red === scores.red &&
      state.scores.blue === scores.blue

    if (chromeSame && zoneSame && flagSame)
      return state

    return {
      status,
      countdown,
      timeLeft,
      scores,
      scoreTarget: scoreTarget ?? state.scoreTarget,
      zones:       zoneSame ? state.zones : zones.map(z => ({ ...z, progress: q(z.progress, 50) })),
      flags:       flagSame ? state.flags : flags,
    }
  }),

  // Quantised before comparing, so a round trip wobbling by fractions of a
  // millisecond cannot force a React commit 30 times a second.
  setNetStats: (next: NetHealth) => battleStore.update(state => {
    const now  = state.net
    const same = now.rttMs === next.rttMs &&
      now.jitterMs === next.jitterMs &&
      now.synced === next.synced &&
      now.pending === next.pending &&
      Math.abs(now.snapshotAgeMs - next.snapshotAgeMs) < 8 &&
      Math.abs(now.correctionM - next.correctionM) < 0.05
    return same ? state : { net: next }
  }),

  applyEvent: (e: BattleEvent, names?: ReadonlyMap<string, string>) => battleStore.update(state => {
    const who = (id: string) => names?.get(id) ?? id
    switch (e.type) {
      case 'kill': {
        const entry: KillFeedEntry = {
          key:    `${toastSeq++}`,
          killer: who(e.hitBy),
          victim: who(e.target),
          weapon: e.weapon,
          team:   state.roster.find(r => r.id === e.hitBy)?.team ?? null,
        }
        return { killFeed: [ entry, ...state.killFeed ].slice(0, KILL_FEED_CAP) }
      }
      case 'flagScored':
        return { toasts: toast(state.toasts, `${e.team.toUpperCase()} core delivered · +5`) }
      case 'flagTaken':
        return { toasts: toast(state.toasts, `${e.team.toUpperCase()} core stolen`) }
      case 'flagReturned':
        return { toasts: toast(state.toasts, `${e.team.toUpperCase()} core returned`) }
      case 'zoneChange': {
        const name = state.zones.find(z => z.id === e.id)?.name ?? e.id
        return { toasts: toast(state.toasts, `${name} → ${e.owner?.toUpperCase() ?? 'NEUTRAL'}`) }
      }
      case 'matchStart':
        return { toasts: [], killFeed: []}
      default:
        return state
    }
  }),

  clearToast:   (key: string) => battleStore.update(state => ({ toasts: state.toasts.filter(t => t !== key) })),
  resetSession: () => battleStore.set({ ...INITIAL_BATTLE }),
}
