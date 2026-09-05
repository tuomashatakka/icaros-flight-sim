/**
 * Pending matches, and the tickets that admit people to them.
 *
 * A lobby entry is not a room. Rooms are expensive — each one boots rapier and
 * starts stepping a world — so one is only allocated when a match actually
 * starts. Until then a match is a name, a config and a list of people.
 */

import { BATTLE_TEAMS } from 'Δengine/battle/arena'
import type { BattleTeam } from 'Δengine/battle/arena'
import type { LobbyListing, LobbyMatchConfig, LobbyPlayer } from 'Δengine/battle/protocol'


export const DEFAULT_MATCH_CONFIG: LobbyMatchConfig = {
  name:       'Skirmish',
  mode:       'ctf',
  maxPlayers: 8,
  botFill:    true,
}

/**
 * How long a ticket is valid.
 *
 * Long enough to cover a page navigation and a scene mount (rapier's WASM and
 * the ship meshes are not instant), short enough that a leaked one is useless.
 */
export const TICKET_TTL_MS = 60_000

export type PendingMatch = {
  id:      string;
  config:  LobbyMatchConfig;
  hostId:  string;
  players: Map<string, LobbyPlayer>;

  // Set once the host starts it. A started match stays listed so late arrivals
  //  can drop into a game in progress.
  live: boolean;

  createdAt: number;
}

type Ticket = {
  matchId:  string;
  playerId: string;
  name:     string;
  expires:  number;
}

export class Matchmaker {
  private readonly matches = new Map<string, PendingMatch>()
  private readonly tickets = new Map<string, Ticket>()
  private readonly now: () => number

  private seq = 0

  constructor (now: () => number = () => Date.now()) {
    this.now = now
  }

  create (hostId: string, config: Partial<LobbyMatchConfig>): PendingMatch {
    const match: PendingMatch = {
      id:        `m${++this.seq}`,
      config:    { ...DEFAULT_MATCH_CONFIG, ...config },
      hostId,
      players:   new Map(),
      live:      false,
      createdAt: this.now(),
    }

    this.matches.set(match.id, match)
    return match
  }

  get (id: string): PendingMatch | undefined {
    return this.matches.get(id)
  }

  list (): LobbyListing[] {
    return [ ...this.matches.values() ].map(match => ({
      ...match.config,
      id:      match.id,
      players: match.players.size,
      live:    match.live,
    }))
  }

  /** The team a joiner should take: whichever side is smaller, red on a tie. */
  teamFor (match: PendingMatch): BattleTeam {
    const [ red, blue ] = BATTLE_TEAMS
    const counts        = { red: 0, blue: 0 } as Record<BattleTeam, number>
    for (const player of match.players.values())
      counts[player.team]++

    return counts[blue] < counts[red] ? blue : red
  }

  join (matchId: string, player: Omit<LobbyPlayer, 'team' | 'ready'>): LobbyPlayer | 'no-such-match' | 'match-full' {
    const match = this.matches.get(matchId)
    if (!match)
      return 'no-such-match'
    if (match.players.size >= match.config.maxPlayers)
      return 'match-full'

    const entry: LobbyPlayer = { ...player, team: this.teamFor(match), ready: false }
    match.players.set(entry.id, entry)
    return entry
  }

  leave (matchId: string, playerId: string): PendingMatch | null {
    const match = this.matches.get(matchId)
    if (!match)
      return null

    match.players.delete(playerId)

    if (match.players.size === 0) {
      // Nobody left to start it. A live match is kept — its room is running and
      // people may still be in it.
      if (!match.live)
        this.matches.delete(matchId)
      return null
    }

    // The host left: hand it to whoever has been waiting longest, rather than
    // stranding a lobby nobody can start.
    if (match.hostId === playerId)
      match.hostId = [ ...match.players.keys() ][0]

    return match
  }

  /** Issue a one-use admission ticket for `/battle`. */
  issueTicket (matchId: string, playerId: string, name: string): string {
    const token = crypto.randomUUID()
    this.tickets.set(token, { matchId, playerId, name, expires: this.now() + TICKET_TTL_MS })
    return token
  }

  /**
   * Spend a ticket. One use only — a ticket that could be replayed would let
   * one lobby seat admit any number of connections.
   */
  redeem (token: string): Ticket | null {
    const ticket = this.tickets.get(token)
    if (!ticket)
      return null

    this.tickets.delete(token)
    return ticket.expires > this.now() ? ticket : null
  }

  /** Drop expired tickets and abandoned lobbies. Called from the room sweep. */
  sweep (maxIdleMs: number): void {
    const at = this.now()

    for (const [ token, ticket ] of this.tickets)
      if (ticket.expires <= at)
        this.tickets.delete(token)

    for (const [ id, match ] of this.matches)
      if (!match.live && match.players.size === 0 && at - match.createdAt > maxIdleMs)
        this.matches.delete(id)
  }
}
