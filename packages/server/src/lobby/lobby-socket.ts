/**
 * Routing for one `/lobby` socket.
 *
 * The lobby is where people gather, pick sides and agree to start; the battle
 * socket is where they play. They are separate connections on purpose — a lobby
 * is idle chatter and a battle is 60 packets a second, and mixing them would
 * mean the lobby's rate limits had to accommodate the game's.
 *
 * Split from the `Bun.serve` wiring so the whole flow can be driven in a test
 * with fake sockets.
 */

import { PROTOCOL_VERSION, parseLobbyMessage } from 'Δengine/battle/protocol'
import { takeToken } from '../net/session'
import { DEFAULT_MATCH_CONFIG } from './matchmaker'
import type { Matchmaker, PendingMatch } from './matchmaker'
import type { RateBucket } from '../net/session'
import type { Store } from '../store/store'
import type { Account } from '../store/store'
import type {
  LobbyClientMessage,
  LobbyErrorCode,
  LobbyServerMessage,
} from 'Δengine/battle/protocol'


export type LobbySink = {
  send (message: LobbyServerMessage): void;
  close (code: number, reason: string): void;
}

export type LobbySocket = {

  /** Stable for the life of the connection; the id a lobby roster uses. */
  playerId: string;

  name:    string;
  account: Account | null;
  matchId: string | null;
  bucket:  RateBucket;
  sink:    LobbySink;
}

export type LobbyDeps = {
  matchmaker: Matchmaker;
  store:      Store;
  now:        () => number;

  /** Every live lobby connection, so a roster change can be fanned out. */
  sockets: Set<LobbySocket>;
}

const CLOSE_ABUSE = 4002

function fail (socket: LobbySocket, code: LobbyErrorCode, message: string): void {
  socket.sink.send({ type: 'lobbyError', code, message })
}

export async function routeLobbyMessage (
  raw: string | ArrayBuffer | Uint8Array,
  socket: LobbySocket,
  deps: LobbyDeps
): Promise<void> {
  if (!takeToken(socket.bucket, deps.now())) {
    fail(socket, 'bad-message', 'too many messages')
    socket.sink.close(CLOSE_ABUSE, 'rate limited')
    return
  }

  const parsed = parseLobbyMessage(raw)
  if (!parsed.ok) {
    fail(socket, 'bad-message', parsed.reason)
    return
  }

  await dispatchLobby(parsed.message, socket, deps)
}

async function dispatchLobby (
  message: LobbyClientMessage,
  socket: LobbySocket,
  deps: LobbyDeps
): Promise<void> {
  switch (message.type) {
    case 'auth':
      await handleAuth(message, socket, deps)
      return
    case 'list':
      socket.sink.send({ type: 'matches', matches: deps.matchmaker.list() })
      return
    case 'create': {
      const match = deps.matchmaker.create(socket.playerId, message.config)
      joinMatch(match.id, socket, deps)
      broadcastMatches(deps)
      return
    }
    case 'join':
      joinMatch(message.matchId, socket, deps)
      broadcastMatches(deps)
      return
    case 'setTeam': {
      const match = currentMatch(socket, deps)
      const entry = match?.players.get(socket.playerId)
      if (!match || !entry)
        return
      entry.team  = message.team
      entry.ready = false
      pushLobby(match, deps)
      return
    }

    case 'ready': {
      const match = currentMatch(socket, deps)
      const entry = match?.players.get(socket.playerId)
      if (!match || !entry)
        return
      entry.ready = message.value
      pushLobby(match, deps)
      return
    }
    case 'start':
      startMatch(socket, deps)
      return
    case 'leave':
      leaveMatch(socket, deps)
      broadcastMatches(deps)
      return
    case 'chat': {
      const match = currentMatch(socket, deps)
      if (!match)
        return
      for (const peer of membersOf(match, deps))
        peer.sink.send({ type: 'chatLine', from: socket.name, text: message.text, at: deps.now() })
    }
  }
}

/**
 * Resolve who this connection is.
 *
 * A token identifies a registered account; a bare name is a guest. Guests are
 * first-class — signing in must never be a gate in front of the game — so a
 * failed token falls back to guest play rather than closing the socket.
 */
async function handleAuth (
  message: Extract<LobbyClientMessage, { type: 'auth' }>,
  socket: LobbySocket,
  deps: LobbyDeps
): Promise<void> {
  if (message.token) {
    const account = await deps.store.resolveSession(message.token)
    if (account) {
      socket.account = account
      socket.name    = account.username
      socket.sink.send({
        type:       'welcome',
        protocol:   PROTOCOL_VERSION,
        playerId:   socket.playerId,
        name:       socket.name,
        registered: true,
        stats:      await deps.store.statsFor(account.id),
      })
      return
    }
  }

  socket.account = null
  socket.name    = message.name?.trim() || 'Pilot'
  socket.sink.send({
    type:       'welcome',
    protocol:   PROTOCOL_VERSION,
    playerId:   socket.playerId,
    name:       socket.name,
    registered: false,
  })
}

function currentMatch (socket: LobbySocket, deps: LobbyDeps): PendingMatch | undefined {
  return socket.matchId ? deps.matchmaker.get(socket.matchId) : undefined
}

function membersOf (match: PendingMatch, deps: LobbyDeps): LobbySocket[] {
  return [ ...deps.sockets ].filter(s => s.matchId === match.id)
}

function pushLobby (match: PendingMatch, deps: LobbyDeps): void {
  const state: LobbyServerMessage = {
    type:    'lobby',
    matchId: match.id,
    hostId:  match.hostId,
    config:  match.config,
    players: [ ...match.players.values() ],
    live:    match.live,
  }

  for (const peer of membersOf(match, deps))
    peer.sink.send(state)
}

function broadcastMatches (deps: LobbyDeps): void {
  const matches = deps.matchmaker.list()
  for (const peer of deps.sockets)
    peer.sink.send({ type: 'matches', matches })
}

function joinMatch (matchId: string, socket: LobbySocket, deps: LobbyDeps): void {
  if (socket.matchId)
    leaveMatch(socket, deps)

  const result = deps.matchmaker.join(matchId, {
    id:         socket.playerId,
    name:       socket.name,
    registered: socket.account !== null,
  })

  if (result === 'no-such-match' || result === 'match-full') {
    fail(socket, result, result === 'match-full' ? 'that match is full' : 'no such match')
    return
  }

  socket.matchId = matchId

  const match    = deps.matchmaker.get(matchId)
  if (!match)
    return

  // Dropping into a match already in progress skips the ready-up entirely —
  // there is nothing left to agree on.
  if (match.live)
    socket.sink.send({
      type:    'starting',
      matchId: match.id,
      ticket:  deps.matchmaker.issueTicket(match.id, socket.playerId, socket.name),
    })

  pushLobby(match, deps)
}

function leaveMatch (socket: LobbySocket, deps: LobbyDeps): void {
  if (!socket.matchId)
    return

  const matchId  = socket.matchId
  socket.matchId = null

  const match = deps.matchmaker.leave(matchId, socket.playerId)
  if (match)
    pushLobby(match, deps)
}

/**
 * Start the match, handing every member a ticket.
 *
 * Only the host may. Readiness is advisory rather than enforced: waiting for
 * one person who wandered off is how a lobby of friends fails to ever play.
 */
function startMatch (socket: LobbySocket, deps: LobbyDeps): void {
  const match = currentMatch(socket, deps)
  if (!match)
    return

  if (match.hostId !== socket.playerId) {
    fail(socket, 'not-host', 'only the host can start the match')
    return
  }

  match.live = true

  for (const peer of membersOf(match, deps))
    peer.sink.send({
      type:    'starting',
      matchId: match.id,
      ticket:  deps.matchmaker.issueTicket(match.id, peer.playerId, peer.name),
    })

  pushLobby(match, deps)
  broadcastMatches(deps)
}

/** Tear down one connection's lobby presence. */
export function dropLobbySocket (socket: LobbySocket, deps: LobbyDeps): void {
  leaveMatch(socket, deps)
  deps.sockets.delete(socket)
  broadcastMatches(deps)
}

export { DEFAULT_MATCH_CONFIG }
