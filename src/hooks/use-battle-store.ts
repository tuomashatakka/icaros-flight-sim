import { create } from 'zustand'
import type { BattleStatus } from '@/engine/battle/sim'
import type { BattleTeam } from '@/engine/battle/arena'
import type { LockPhase, WeaponId } from '@/engine/battle/weapons'


export type BattleRosterEntry = {
  id:     string;
  name:   string;
  team:   BattleTeam;
  isBot:  boolean;
  kills:  number;
  deaths: number;
}

export type BattleZoneView = {
  id:   string;
  name: string;

  /** 1–2 character code for the pip glyph. */
  short:     string;
  owner:     BattleTeam | null;
  progress:  number;
  capturing: BattleTeam | null;
  contested: boolean;
}

export type BattleFlagView = { team: BattleTeam; state: string; carrierId: string | null }

export type LockOnState = {
  phase:    LockPhase;
  targetId: string | null;
  name:     string | null;
  distance: number;
  team:     BattleTeam | null;

  /** 0..1 acquisition meter. */
  progress: number;
}

export type WeaponView = {
  id: WeaponId;

  /** 1 = just fired, 0 = ready. */
  cooldown: number;

  /** The slot cannot fire without a completed lock. */
  needsLock: boolean;
}

export type KillFeedEntry = {
  key:    string;
  killer: string;
  victim: string;
  weapon: WeaponId | null;
  team:   BattleTeam | null;
}

export const IDLE_LOCK: LockOnState = {
  phase:    'idle',
  targetId: null,
  name:     null,
  distance: 0,
  team:     null,
  progress: 0,
}

export type BattleSessionState = {
  status:    BattleStatus | 'idle' | 'connecting' | 'queued' | 'error';
  error:     string | null;
  playerId:  string | null;
  myName:    string | null;
  myTeam:    BattleTeam | null;
  myShip:    string | null;
  myHealth:  number;
  maxHealth: number;
  myBoost:   number;
  myKills:   number;
  myDeaths:  number;
  carrying:  BattleTeam | null;
  lockOn:    LockOnState;

  /** Normalised R/F vertical aim, -1..1. Drives where the reticle sits. */
  aimPitch:         number;
  primary:          WeaponView | null;
  secondary:        WeaponView | null;
  countdown:        number;
  timeLeft:         number;
  scores:           Record<BattleTeam, number>;
  scoreTarget:      number;
  roster:           BattleRosterEntry[];
  zones:            BattleZoneView[];
  flags:            BattleFlagView[];
  toasts:           string[];
  killFeed:         KillFeedEntry[];
  verifiedTicks:    number;
  lastVerifiedHash: string | null;
  hashMatchStatus:  'ok' | 'mismatch' | 'unverified';
}

const initial: BattleSessionState = {
  status:           'idle',
  error:            null,
  playerId:         null,
  myName:           null,
  myTeam:           null,
  myShip:           null,
  myHealth:         100,
  maxHealth:        100,
  myBoost:          1,
  myKills:          0,
  myDeaths:         0,
  carrying:         null,
  lockOn:           IDLE_LOCK,
  aimPitch:         0,
  primary:          null,
  secondary:        null,
  countdown:        0,
  timeLeft:         0,
  scores:           { red: 0, blue: 0 },
  scoreTarget:      25,
  roster:           [],
  zones:            [],
  flags:            [],
  toasts:           [],
  killFeed:         [],
  verifiedTicks:    0,
  lastVerifiedHash: null,
  hashMatchStatus:  'unverified',
}

let toastSeq = 0

function toast (list: string[], text: string, cap = 3): string[] {
  return [ `${toastSeq++}|${text}`, ...list ].slice(0, cap)
}

/** Quantised so a value that only wiggles in the noise cannot force a commit. */
const q = (v: number, steps = 100) => Math.round(v * steps) / steps

export const useBattleStore = create<BattleSessionState & {
  setStatus: (s: BattleSessionState['status']) => void;
  setError:  (msg: string) => void;
  joined:    (p: { playerId: string; team: BattleTeam; shipId: string; name: string }) => void;
  setRoster: (r: BattleRosterEntry[]) => void;
  setChrome:       (c: {
    status:       BattleStatus;
    countdown:    number;
    timeLeft:     number;
    scores:       Record<BattleTeam, number>;
    scoreTarget?: number;
    zones:        BattleZoneView[];
    flags:        BattleFlagView[];
  }) => void;
  setPilot:        (p: {
    health:    number;
    maxHealth: number;
    boost:     number;
    kills:     number;
    deaths:    number;
    carrying:  BattleTeam | null;
  }) => void;
  setLockOn:       (lock: LockOnState) => void;
  setAimPitch:     (aim: number) => void;
  setWeapons:      (primary: WeaponView, secondary: WeaponView) => void;
  setVerification: (v: { tick: number; hash: string; matched: boolean }) => void;
  applyEvent:      (e: import('@/engine/battle/sim').BattleEvent, names?: Map<string, string>) => void;
  clearToast:      (key: string) => void;
  resetSession:    () => void;
}>(set => ({
  ...initial,

  setStatus: s => set({ status: s }),

  setError: msg => set({ status: 'error', error: msg }),

  setLockOn: next => set(state => {
    const prev = state.lockOn
    // The meter ticks 60×/s; only commit when it moves a visible amount.
    const same = prev.phase === next.phase &&
      prev.targetId === next.targetId &&
      Math.abs(prev.progress - next.progress) < 0.02 &&
      Math.abs(prev.distance - next.distance) < 2
    return same ? {} : { lockOn: { ...next, progress: q(next.progress, 50), distance: Math.round(next.distance) }}
  }),

  // Quantised for the same reason the lock meter is: the trim integrates every
  // tick, and a React commit per 0.6 mrad of aim is 60 renders a second.
  setAimPitch: aim => set(state => {
    const next = q(aim, 100)
    return next === state.aimPitch ? {} : { aimPitch: next }
  }),

  setWeapons: (primary, secondary) => set(state => {
    const same = state.primary?.id === primary.id &&
      state.secondary?.id === secondary.id &&
      Math.abs((state.primary?.cooldown ?? 0) - primary.cooldown) < 0.05 &&
      Math.abs((state.secondary?.cooldown ?? 0) - secondary.cooldown) < 0.05
    return same
      ? {}
      : {
        primary:   { ...primary, cooldown: q(primary.cooldown, 20) },
        secondary: { ...secondary, cooldown: q(secondary.cooldown, 20) },
      }
  }),

  setPilot: ({ health, maxHealth, boost, kills, deaths, carrying }) => set(state => {
    const same = state.myHealth === health &&
      state.maxHealth === maxHealth &&
      state.myKills === kills &&
      state.myDeaths === deaths &&
      state.carrying === carrying &&
      Math.abs(state.myBoost - boost) < 0.02
    return same
      ? {}
      : {
        myHealth:  health,
        maxHealth: maxHealth,
        myBoost:   q(boost, 50),
        myKills:   kills,
        myDeaths:  deaths,
        carrying,
      }
  }),

  joined: ({ playerId, team, shipId, name }) => set({
    playerId, myTeam: team, myShip: shipId, myName: name, status: 'queued',
  }),

  setRoster: roster => {
    // Keep it stable enough to not re-render the HUD every packet: only
    // replace when membership or a score actually changed.
    set(state => {
      const same = state.roster.length === roster.length &&
        state.roster.every((r, i) =>
          r.id === roster[i].id &&
          r.team === roster[i].team &&
          r.isBot === roster[i].isBot &&
          r.kills === roster[i].kills &&
          r.deaths === roster[i].deaths)
      return same ? {} : { roster }
    })
  },

  setChrome: ({ status, countdown, timeLeft, scores, scoreTarget, zones, flags }) => set(state => {
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
      return {}

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

  setVerification: ({ hash, matched }) => set(state => ({
    verifiedTicks:    matched ? state.verifiedTicks + 1 : state.verifiedTicks,
    lastVerifiedHash: hash,
    hashMatchStatus:  matched ? 'ok' : 'mismatch',
  })),

  applyEvent: (e, names) => set(state => {
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
        return { killFeed: [ entry, ...state.killFeed ].slice(0, 5) }
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
        return {}
    }
  }),

  clearToast: key => set(state => ({ toasts: state.toasts.filter(t => t !== key) })),

  resetSession: () => set({ ...initial }),
}))
