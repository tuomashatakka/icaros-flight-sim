import { create } from 'zustand'
import type { BattleStatus } from '@/engine/battle/sim'
import type { BattleTeam } from '@/engine/battle/arena'


export type BattleRosterEntry = {
  id:    string;
  name:  string;
  team:  BattleTeam;
  isBot: boolean;
}

export type BattleZoneView = { id: string; owner: BattleTeam | null; progress: number }
export type BattleFlagView = { team: BattleTeam; state: string; carrierId: string | null }

export type LockOnState = {
  active:   boolean;
  targetId: string | null;
  name:     string | null;
  distance: number;
  team:     BattleTeam | null;
}

export type BattleSessionState = {
  status:           BattleStatus | 'idle' | 'connecting' | 'queued' | 'error';
  error:            string | null;
  playerId:         string | null;
  myName:           string | null;
  myTeam:           BattleTeam | null;
  myShip:           string | null;
  myHealth:         number;
  maxHealth:        number;
  lockOn:           LockOnState;
  countdown:        number;
  timeLeft:         number;
  scores:           Record<BattleTeam, number>;
  roster:           BattleRosterEntry[];
  zones:            BattleZoneView[];
  flags:            BattleFlagView[];
  toasts:           string[];
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
  lockOn:           { active: false, targetId: null, name: null, distance: 0, team: null },
  countdown:        0,
  timeLeft:         0,
  scores:           { red: 0, blue: 0 },
  roster:           [],
  zones:            [],
  flags:            [],
  toasts:           [],
  verifiedTicks:    0,
  lastVerifiedHash: null,
  hashMatchStatus:  'unverified',
}

let toastSeq = 0

function toast (list: string[], text: string, cap = 3): string[] {
  const next = [ `${toastSeq++}|${text}`, ...list ].slice(0, cap)
  return next
}

export const useBattleStore = create<BattleSessionState & {
  setStatus:       (s: BattleSessionState['status']) => void;
  setError:        (msg: string) => void;
  joined:          (p: { playerId: string; team: BattleTeam; shipId: string; name: string }) => void;
  setRoster:       (r: BattleRosterEntry[]) => void;
  setChrome:       (c: { status: BattleStatus; countdown: number; timeLeft: number; scores: Record<BattleTeam, number>; zones: BattleZoneView[]; flags: BattleFlagView[] }) => void;
  setHealth:       (hp: number, maxHp?: number) => void;
  setLockOn:       (lock: LockOnState) => void;
  setVerification: (v: { tick: number; hash: string; matched: boolean }) => void;
  applyEvent:      (e: import('@/engine/battle/sim').BattleEvent) => void;
  clearToast:      (key: string) => void;
  resetSession:    () => void;
}>(set => ({
  ...initial,

  setStatus: s => set({ status: s }),

  setError: msg => set({ status: 'error', error: msg }),

  setHealth: (hp, maxHp = 100) => set({ myHealth: hp, maxHealth: maxHp }),

  setLockOn: lockOn => set({ lockOn }),

  joined: ({ playerId, team, shipId, name }) => set({
    playerId, myTeam: team, myShip: shipId, myName: name, status: 'queued',
  }),

  setRoster: roster => {
    // Keep it stable enough to not re-render the HUD every packet: only
    // replace when membership or a name/team actually changed.
    set(state => {
      const same = state.roster.length === roster.length &&
        state.roster.every((r, i) => r.id === roster[i].id && r.team === roster[i].team && r.isBot === roster[i].isBot)
      return same ? {} : { roster }
    })
  },

  setChrome: ({ status, countdown, timeLeft, scores, zones, flags }) => set(state => {
    const zoneSame = zones.length === state.zones.length &&
      zones.every((z, i) => z.owner === state.zones[i].owner && z.id === state.zones[i].id)
    const flagSame = flags.length === state.flags.length && flags.every((f, i) => f.team === state.flags[i].team && f.state === state.flags[i].state)
    return {
      status,
      countdown,
      timeLeft,
      scores,
      zones: zoneSame ? state.zones : zones.map((z, i) => ({ ...z, progress: Math.round(z.progress * 10) / 10 })),
      flags: flagSame ? state.flags : flags,
    }
  }),

  setVerification: ({ hash, matched }) => set(state => ({
    verifiedTicks:    matched ? state.verifiedTicks + 1 : state.verifiedTicks,
    lastVerifiedHash: hash,
    hashMatchStatus:  matched ? 'ok' : 'mismatch',
  })),

  applyEvent: e => set(state => {
    switch (e.type) {
      case 'flagScored':
        return { toasts: toast(state.toasts, `${e.team.toUpperCase()} scored! +3`) }
      case 'flagTaken':
        return { toasts: toast(state.toasts, `${e.team.toUpperCase()} flag stolen`) }
      case 'flagReturned':
        return { toasts: toast(state.toasts, `${e.team.toUpperCase()} flag returned`) }
      case 'zoneChange':
        return { toasts: toast(state.toasts, `${e.id.toUpperCase()} → ${e.owner?.toUpperCase() ?? 'neutral'}`) }
      case 'matchStart':
        return { toasts: []}
      default:
        return {}
    }
  }),

  clearToast: key => set(state => ({ toasts: state.toasts.filter(t => t !== key) })),

  resetSession: () => set({ ...initial }),
}))
