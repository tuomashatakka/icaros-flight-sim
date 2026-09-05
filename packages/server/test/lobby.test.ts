/**
 * The lobby state machine.
 *
 * Driven through `routeLobbyMessage` with fake sockets rather than by poking
 * the matchmaker directly, because the interesting bugs are in the routing:
 * who is told what, who is allowed to do what, and what happens when someone
 * leaves at an awkward moment.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { Matchmaker } from '../src/lobby/matchmaker'
import { dropLobbySocket, routeLobbyMessage } from '../src/lobby/lobby-socket'
import { MemoryStore } from '@crash-velocity/data'
import { createBucket } from '../src/net/session'
import type { LobbyDeps, LobbySocket } from '../src/lobby/lobby-socket'
import type { LobbyServerMessage, LobbyState } from 'Δengine/battle/protocol'


let clock = 1_000
const now  = () => clock

function makeDeps (): LobbyDeps {
  return { matchmaker: new Matchmaker(now), store: new MemoryStore(), now, sockets: new Set() }
}

function connect (deps: LobbyDeps, id: string): LobbySocket & { sent: LobbyServerMessage[] } {
  const sent: LobbyServerMessage[] = []
  const socket                     = {
    playerId: id,
    name:     id,
    account:  null,
    matchId:  null,
    bucket:   createBucket(now()),
    sent,
    sink:     { send: (m: LobbyServerMessage) => sent.push(m), close: () => {} },
  } as LobbySocket & { sent: LobbyServerMessage[] }

  deps.sockets.add(socket)
  return socket
}

const send = (deps: LobbyDeps, socket: LobbySocket, message: unknown) =>
  routeLobbyMessage(JSON.stringify(message), socket, deps)

type SocketType = { sent: LobbyServerMessage[] }

const lastLobby = (socket: SocketType): LobbyState | undefined =>
  [ ...socket.sent ].reverse().find(m => m.type === 'lobby') as LobbyState | undefined

describe('lobby', () => {
  let deps: LobbyDeps

  beforeEach(() => {
    clock = 1_000
    deps  = makeDeps()
  })

  describe('identity', () => {
    it('welcomes a guest under the name they asked for', async () => {
      const socket = connect(deps, 'a')
      await send(deps, socket, { type: 'auth', name: 'Iceman' })

      const welcome = socket.sent.find(m => m.type === 'welcome')
      expect(welcome).toMatchObject({ registered: false, name: 'Iceman' })
    })

    it('welcomes a registered account under its own name, with stats', async () => {
      const account = await deps.store.createAccount('Maverick', 'hash')
      const session = await deps.store.createSession(account!.id, 60_000)

      const socket = connect(deps, 'a')
      await send(deps, socket, { type: 'auth', token: session.token })

      const welcome = socket.sent.find(m => m.type === 'welcome')
      expect(welcome).toMatchObject({ registered: true, name: 'Maverick' })
      expect(welcome).toHaveProperty('stats')
    })

    it('falls back to guest play on a bad token rather than refusing', async () => {
      // Signing in must never be a gate in front of the game.
      const socket = connect(deps, 'a')
      await send(deps, socket, { type: 'auth', token: 'not-a-real-token', name: 'Ghost' })

      const welcome = socket.sent.find(m => m.type === 'welcome')
      expect(welcome).toMatchObject({ registered: false, name: 'Ghost' })
    })
  })

  describe('matches', () => {
    it('puts the creator in their own match as host', async () => {
      const host = connect(deps, 'host')
      await send(deps, host, { type: 'auth', name: 'Host' })
      await send(deps, host, { type: 'create', config: { name: 'Danger Zone' }})

      const state = lastLobby(host)
      expect(state?.hostId).toBe('host')
      expect(state?.config.name).toBe('Danger Zone')
      expect(state?.players.map(p => p.id)).toEqual([ 'host' ])
    })

    it('balances teams as people arrive', async () => {
      const host  = connect(deps, 'host')
      const guest = connect(deps, 'guest')

      await send(deps, host, { type: 'auth', name: 'Host' })
      await send(deps, host, { type: 'create', config: {}})

      const matchId = lastLobby(host)!.matchId

      await send(deps, guest, { type: 'auth', name: 'Guest' })
      await send(deps, guest, { type: 'join', matchId })

      const teams = lastLobby(host)!.players.map(p => p.team)
      expect(new Set(teams).size).toBe(2)
    })

    it('refuses a join past the player cap', async () => {
      const host  = connect(deps, 'host')
      const extra = connect(deps, 'extra')

      await send(deps, host, { type: 'auth', name: 'Host' })
      await send(deps, host, { type: 'create', config: { maxPlayers: 2 }})

      const matchId = lastLobby(host)!.matchId

      for (const id of [ 'b' ]) {
        const s = connect(deps, id)
        await send(deps, s, { type: 'auth', name: id })
        await send(deps, s, { type: 'join', matchId })
      }

      await send(deps, extra, { type: 'auth', name: 'Extra' })
      await send(deps, extra, { type: 'join', matchId })

      expect(extra.sent.some(m => m.type === 'lobbyError' && m.code === 'match-full')).toBe(true)
    })

    it('refuses a join to a match that does not exist', async () => {
      const socket = connect(deps, 'a')
      await send(deps, socket, { type: 'auth', name: 'A' })
      await send(deps, socket, { type: 'join', matchId: 'nope' })

      expect(socket.sent.some(m => m.type === 'lobbyError' && m.code === 'no-such-match')).toBe(true)
    })

    it('moves a player between matches rather than leaving them in both', async () => {
      const host  = connect(deps, 'host')
      const mover = connect(deps, 'mover')

      await send(deps, host, { type: 'auth', name: 'Host' })
      await send(deps, host, { type: 'create', config: { name: 'First' }})

      const first = lastLobby(host)!.matchId

      await send(deps, mover, { type: 'auth', name: 'Mover' })
      await send(deps, mover, { type: 'join', matchId: first })
      await send(deps, mover, { type: 'create', config: { name: 'Second' }})

      expect(lastLobby(host)!.players.map(p => p.id)).toEqual([ 'host' ])
      expect(lastLobby(mover)!.config.name).toBe('Second')
    })
  })

  describe('starting', () => {
    it('lets only the host start, and tickets everyone when they do', async () => {
      const host  = connect(deps, 'host')
      const guest = connect(deps, 'guest')

      await send(deps, host, { type: 'auth', name: 'Host' })
      await send(deps, host, { type: 'create', config: {}})

      const matchId = lastLobby(host)!.matchId

      await send(deps, guest, { type: 'auth', name: 'Guest' })
      await send(deps, guest, { type: 'join', matchId })

      await send(deps, guest, { type: 'start' })
      expect(guest.sent.some(m => m.type === 'lobbyError' && m.code === 'not-host')).toBe(true)
      expect(guest.sent.some(m => m.type === 'starting')).toBe(false)

      await send(deps, host, { type: 'start' })
      expect(host.sent.some(m => m.type === 'starting')).toBe(true)
      expect(guest.sent.some(m => m.type === 'starting')).toBe(true)
    })

    it('starts without waiting on stragglers', async () => {
      // Readiness is advisory. Waiting for one person who wandered off is how a
      // lobby of friends fails to ever play.
      const host = connect(deps, 'host')
      await send(deps, host, { type: 'auth', name: 'Host' })
      await send(deps, host, { type: 'create', config: {}})
      await send(deps, host, { type: 'start' })

      expect(host.sent.some(m => m.type === 'starting')).toBe(true)
    })

    it('tickets a late arrival straight into a live match', async () => {
      const host = connect(deps, 'host')
      await send(deps, host, { type: 'auth', name: 'Host' })
      await send(deps, host, { type: 'create', config: {}})

      const matchId = lastLobby(host)!.matchId
      await send(deps, host, { type: 'start' })

      const late = connect(deps, 'late')
      await send(deps, late, { type: 'auth', name: 'Late' })
      await send(deps, late, { type: 'join', matchId })

      // Nothing left to agree on, so the ready-up is skipped entirely.
      expect(late.sent.some(m => m.type === 'starting')).toBe(true)
    })
  })

  describe('leaving', () => {
    it('hands the lobby to someone else when the host goes', async () => {
      const host  = connect(deps, 'host')
      const guest = connect(deps, 'guest')

      await send(deps, host, { type: 'auth', name: 'Host' })
      await send(deps, host, { type: 'create', config: {}})

      const matchId = lastLobby(host)!.matchId

      await send(deps, guest, { type: 'auth', name: 'Guest' })
      await send(deps, guest, { type: 'join', matchId })

      dropLobbySocket(host, deps)

      // Otherwise the lobby is stranded — nobody left can start it.
      expect(lastLobby(guest)?.hostId).toBe('guest')
    })

    it('removes an empty pending match from the listing', async () => {
      const host = connect(deps, 'host')
      await send(deps, host, { type: 'auth', name: 'Host' })
      await send(deps, host, { type: 'create', config: {}})
      expect(deps.matchmaker.list()).toHaveLength(1)

      dropLobbySocket(host, deps)
      expect(deps.matchmaker.list()).toHaveLength(0)
    })

    it('keeps a live match listed after its lobby empties', async () => {
      // Its room is running and people may still be playing in it.
      const host = connect(deps, 'host')
      await send(deps, host, { type: 'auth', name: 'Host' })
      await send(deps, host, { type: 'create', config: {}})
      await send(deps, host, { type: 'start' })

      dropLobbySocket(host, deps)
      expect(deps.matchmaker.list()).toHaveLength(1)
    })
  })

  describe('tickets', () => {
    it('spends a ticket exactly once', async () => {
      const host = connect(deps, 'host')
      await send(deps, host, { type: 'auth', name: 'Host' })
      await send(deps, host, { type: 'create', config: {}})
      await send(deps, host, { type: 'start' })

      const starting = host.sent.find(m => m.type === 'starting')
      const ticket   = (starting as { ticket: string }).ticket

      // A replayable ticket would let one lobby seat admit any number of
      // connections.
      expect(deps.matchmaker.redeem(ticket)).not.toBeNull()
      expect(deps.matchmaker.redeem(ticket)).toBeNull()
    })

    it('refuses an expired ticket', async () => {
      const host = connect(deps, 'host')
      await send(deps, host, { type: 'auth', name: 'Host' })
      await send(deps, host, { type: 'create', config: {}})
      await send(deps, host, { type: 'start' })

      const starting = host.sent.find(m => m.type === 'starting')
      const ticket   = (starting as { ticket: string }).ticket

      clock += 120_000
      expect(deps.matchmaker.redeem(ticket)).toBeNull()
    })
  })

  describe('input validation', () => {
    it('refuses a malformed message without closing the socket', async () => {
      const socket = connect(deps, 'a')
      await send(deps, socket, { type: 'chat' })
      await routeLobbyMessage('not json', socket, deps)

      expect(socket.sent.every(m => m.type === 'lobbyError')).toBe(true)
      expect(socket.sent).toHaveLength(2)
    })
  })
})
