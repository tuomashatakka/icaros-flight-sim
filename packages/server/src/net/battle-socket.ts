/**
 * Routing for one `/battle` socket.
 *
 * Split from the `Bun.serve` wiring so the whole client-facing protocol can be
 * exercised in a test with a fake socket — the alternative is only ever finding
 * routing bugs by playing the game.
 */

import { PROTOCOL_VERSION, parseClientMessage } from 'Δengine/battle/protocol'
import { takeToken } from './session'
import type { SocketData } from './session'
import type { Registry } from '../match/registry'
import type { BattleRoom, RoomClient } from '../match/room'
import type { ServerConfig } from '../config'
import type { ClientMessage, ErrorCode, ServerMessage } from 'Δengine/battle/protocol'


export type Sink = {
  send (message: ServerMessage): void;
  close (code: number, reason: string): void;
}

export type RouteDeps = {
  config:   ServerConfig;
  registry: Registry;
  now:      () => number;

  /**
   * Spend a lobby ticket, or null when there is no lobby in play.
   *
   * Optional because a direct `/battle` connection is still allowed — it is
   * what the dev CLI and a bare `?match=` link do. A ticket, when present,
   * carries the name and match the lobby agreed on, so a client cannot join a
   * different room than the one it was admitted to.
   */
  redeemTicket?: (token: string) => { matchId: string; name: string } | null;
}

/** WebSocket close codes. 4000+ is the application-defined range. */
export const CLOSE_PROTOCOL = 4001
export const CLOSE_ABUSE    = 4002
export const CLOSE_SHUTDOWN = 4003

function fail (sink: Sink, code: ErrorCode, message: string): void {
  sink.send({ type: 'error', code, message })
}

export async function routeMessage (
  raw: string | ArrayBuffer | Uint8Array,
  data: SocketData,
  sink: Sink,
  deps: RouteDeps
): Promise<void> {
  const at = deps.now()

  if (!takeToken(data.bucket, at)) {
    fail(sink, 'rate-limited', 'too many messages')
    sink.close(CLOSE_ABUSE, 'rate limited')
    return
  }

  const parsed = parseClientMessage(raw)
  if (!parsed.ok) {
    // Refused, not closed: a single malformed frame is routine on a public
    // socket, and killing the connection would turn one bad packet into a
    // dropped match.
    fail(sink, 'bad-message', parsed.reason)
    return
  }

  await dispatch(parsed.message, data, sink, deps)
}

async function dispatch (
  message: ClientMessage,
  data: SocketData,
  sink: Sink,
  deps: RouteDeps
): Promise<void> {
  switch (message.type) {
    case 'join':
      await handleJoin(message, data, sink, deps)
      return
    case 'input':
      if (data.room && data.client)
        data.room.acceptInput(data.client.playerId, message)
      return
    case 'ping':
      // Echoed verbatim so the client can pair reply to send and compute RTT
      // without keeping its own table of outstanding pings.
      sink.send({
        type:         'pong',
        t0:           message.t0,
        serverTimeMs: deps.now(),
        serverTick:   data.room?.tick ?? 0,
      })
      return
    case 'leave':
      if (data.room && data.client) {
        data.room.leave(data.client.playerId)
        data.room   = null
        data.client = null
      }
      return
    case 'dev':
      if (!deps.config.devCommands)
        return
      applyDevCommand(message, data)
  }
}

/**
 * Admit one socket to a room, or refuse it.
 *
 * Split out of `dispatch` because it is the only branch that is more than a
 * forward: it resolves a room, decides between a fresh seat and a resumed one,
 * and answers with everything the client needs to start rendering on server
 * time.
 */
async function handleJoin (
  message: Extract<ClientMessage, { type: 'join' }>,
  data: SocketData,
  sink: Sink,
  deps: RouteDeps
): Promise<void> {
  if (message.protocol !== PROTOCOL_VERSION) {
    // A stale tab decoding a newer wire produces garbage that reads as a
    // physics bug, so this is refused loudly at the door.
    fail(sink, 'protocol-mismatch', `server speaks protocol ${PROTOCOL_VERSION}, client sent ${message.protocol}`)
    sink.close(CLOSE_PROTOCOL, 'protocol mismatch')
    return
  }

  if (data.client) {
    fail(sink, 'bad-message', 'already joined')
    return
  }

  // A ticket names the match, and outranks whatever the query string asked
  // for: the lobby decided where this player belongs.
  let roomId = data.roomId
  let name   = message.name

  if (message.ticket) {
    const ticket = deps.redeemTicket?.(message.ticket) ?? null
    if (!ticket) {
      fail(sink, 'bad-ticket', 'that invitation has expired')
      sink.close(CLOSE_PROTOCOL, 'bad ticket')
      return
    }
    roomId = ticket.matchId
    name   = ticket.name
  }

  const room = roomId
    ? await deps.registry.create(roomId)
    : await deps.registry.defaultRoom()

  const client = seatFor({ ...message, name }, room, sink)
  if (!client)
    return

  data.room   = room
  data.client = client

  const player = room.sim.getPlayer(client.playerId)
  sink.send({
    type:         'joined',
    protocol:     PROTOCOL_VERSION,
    playerId:     client.playerId,
    name:         client.name,
    team:         player?.team ?? 'red',
    shipId:       player?.shipId ?? message.shipId,
    status:       room.sim.status,
    serverTick:   room.tick,
    serverTimeMs: room.serverTimeMs(),
    tickHz:       room.tickHz,
    snapshotHz:   room.snapshotHz,
    session:      client.session,
    arenaId:      room.arenaId,
  })

  room.broadcastRoster()
}

/** Reclaim the ship a session token owns, or take a new seat. */
function seatFor (
  message: Extract<ClientMessage, { type: 'join' }>,
  room: BattleRoom,
  sink: Sink
): RoomClient | null {
  const resumed = message.session ? room.resume(message.session, m => sink.send(m)) : null
  if (resumed)
    return resumed

  const result = room.join(message.name, message.shipId, m => sink.send(m), message.loadout)
  if (result.ok)
    return result.client

  fail(sink, 'room-full', 'this match is full')
  return null
}

/**
 * The network replacement for what `window.__devBattle` used to do by reaching
 * into a local sim: place an enemy, aim the local ship, force a match phase.
 * Ignored entirely unless the server was started with `DEV_COMMANDS=1`, so the
 * production behaviour is "this family does not exist".
 */
function applyDevCommand (
  message: Extract<ClientMessage, { type: 'dev' }>,
  data: SocketData
): void {
  const room = data.room
  const self = data.client
  if (!room || !self)
    return

  switch (message.cmd) {
    case 'place': {
      const target = message.id
        ? room.sim.getPlayer(message.id)
        : room.sim.players.find(p => p.id !== self.playerId)
      if (!target)
        return

      target.chassis.setTranslation({ x: message.x, y: message.y, z: message.z }, true)
      target.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true)
      target.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true)

      // Bumping the respawn counter is what tells every client to snap its
      // interpolator instead of blending a ship across the arena.
      target.respawnIndex++
      return
    }

    case 'face': {
      const player = room.sim.getPlayer(self.playerId)
      if (!player)
        return

      const t   = player.chassis.translation()
      const yaw = Math.atan2(message.x - t.x, message.z - t.z)
      player.chassis.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true)
      player.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true)
      player.respawnIndex++
      return
    }
    case 'status':
      room.sim.status = message.status
  }
}
