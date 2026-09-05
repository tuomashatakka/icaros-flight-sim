/**
 * Lobby state for React.
 *
 * Unlike `use-battle-store`, this one is allowed to be an ordinary React store:
 * a lobby changes when somebody clicks something, not sixty times a second, so
 * there is nothing here to protect the render loop from.
 */

import { create } from 'zustand'
import type { BattleTeam } from 'Δengine/battle/arena'
import type { LobbyListing, LobbyMatchConfig, LobbyPlayer } from 'Δengine/battle/protocol'


export type LobbyStatus = 'idle' | 'connecting' | 'ready' | 'error'

export type LobbyChatEntry = {
  key:  string;
  from: string;
  text: string;
}

export type LobbySessionState = {
  status: LobbyStatus;
  error:  string | null;

  playerId:   string | null;
  name:       string;
  registered: boolean;
  stats:      { matches: number; kills: number; deaths: number; captures: number } | null;

  matches: LobbyListing[];

  /** The match this client is sitting in, if any. */
  matchId: string | null;
  hostId:  string | null;
  config:  LobbyMatchConfig | null;
  players: LobbyPlayer[];
  live:    boolean;

  /** Set when the server hands out an admission ticket. The page navigates on it. */
  ticket: string | null;

  chat: LobbyChatEntry[];
}

const initial: LobbySessionState = {
  status:     'idle',
  error:      null,
  playerId:   null,
  name:       'Pilot',
  registered: false,
  stats:      null,
  matches:    [],
  matchId:    null,
  hostId:     null,
  config:     null,
  players:    [],
  live:       false,
  ticket:     null,
  chat:       [],
}

let chatSeq = 0

export const useLobbyStore = create<LobbySessionState & {
  setStatus:  (status: LobbyStatus) => void;
  setError:   (error: string | null) => void;
  welcomed:   (p: Pick<LobbySessionState, 'playerId' | 'name' | 'registered' | 'stats'>) => void;
  setMatches: (matches: LobbyListing[]) => void;
  setLobby:   (p: Pick<LobbySessionState, 'matchId' | 'hostId' | 'config' | 'players' | 'live'>) => void;
  setTicket:  (ticket: string | null) => void;
  addChat:    (from: string, text: string) => void;
  leftMatch:  () => void;
  reset:      () => void;
  isHost:     () => boolean;
  me:         () => LobbyPlayer | undefined;
}>((set, get) => ({
  ...initial,

  setStatus: status => set({ status }),
  setError:  error => set({ error, status: error ? 'error' : get().status }),

  welcomed: ({ playerId, name, registered, stats }) =>
    set({ playerId, name, registered, stats, status: 'ready', error: null }),

  setMatches: matches => set({ matches }),

  setLobby: ({ matchId, hostId, config, players, live }) =>
    set({ matchId, hostId, config, players, live }),

  setTicket: ticket => set({ ticket }),

  // Capped: a lobby left open all evening should not grow without bound.
  addChat: (from, text) =>
    set(state => ({ chat: [ ...state.chat, { key: `${chatSeq++}`, from, text }].slice(-50) })),

  leftMatch: () => set({ matchId: null, hostId: null, config: null, players: [], live: false, ticket: null, chat: []}),

  reset: () => set({ ...initial }),

  isHost: () => {
    const { hostId, playerId } = get()
    return hostId !== null && hostId === playerId
  },

  me: () => {
    const { players, playerId } = get()
    return players.find(p => p.id === playerId)
  },
}))

export type { BattleTeam, LobbyListing, LobbyMatchConfig, LobbyPlayer }
