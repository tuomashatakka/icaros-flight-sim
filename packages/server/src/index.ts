/**
 * The Crash Velocity battle server.
 *
 * A persistent, stateful process: it holds every live match in memory and steps
 * them at a fixed rate. That is exactly what a serverless host cannot run, and
 * why this is a separate app rather than a Next.js route — the client stays on
 * whatever static host it likes and connects here over a WebSocket.
 *
 *     bun run dev:server        # this alone
 *     bun run dev:all           # this plus the Next client
 *
 * It no longer owns identity. Registration and login are Next route handlers on
 * Vercel, next to the database; this process only *reads* a session token, to
 * decide whether a lobby connection is a registered pilot or a guest. What is
 * left here is what genuinely needs a live process: the sockets, the matchmaker
 * and the tick loop.
 *
 * Nothing here is host-specific. Every knob is an environment variable with a
 * localhost default (see `config.ts` and `@crash-velocity/data`'s `openStore`).
 */

import { loadConfig } from './config'
import { createRegistry } from './match/registry'
import { CLOSE_SHUTDOWN, routeMessage } from './net/battle-socket'
import { MAX_MESSAGE_BYTES, createBucket, originAllowed } from './net/session'
import { Matchmaker } from './lobby/matchmaker'
import { dropLobbySocket, routeLobbyMessage } from './lobby/lobby-socket'
import { migrateIfRequested, openStore } from './store/open'
import { storeDescription } from '@crash-velocity/data'
import { jsonCodec } from 'Δengine/battle/protocol'
import type { LobbySocket } from './lobby/lobby-socket'
import type { SocketData } from './net/session'
import type { LobbyServerMessage, ServerMessage } from 'Δengine/battle/protocol'
import type { ServerWebSocket } from 'bun'


const config    = loadConfig()
const now       = () => Date.now()
const startedAt = now()

await migrateIfRequested()

const store = await openStore()

const registry   = createRegistry(config)
const matchmaker = new Matchmaker(now)
const lobbies    = new Set<LobbySocket>()

/** Abandoned lobbies and expired tickets, swept on the same cadence as rooms. */
setInterval(() => matchmaker.sweep(10 * 60_000), 60_000).unref?.()

// This process is served from a different origin than the client (Next on
// :9002, this on :9003), so its remaining GETs carry CORS. The sockets do not
// need it — browsers do not apply CORS to WebSockets, which is what
// `originAllowed` covers instead.
const corsHeaders = () => ({
  'content-type':                 'application/json',
  'access-control-allow-origin':  config.originAllowlist[0] ?? '*',
  'access-control-allow-headers': 'content-type',
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders() })

const server = Bun.serve<SocketData | LobbySocket, never>({
  hostname: config.host,
  port:     config.port,

  async fetch (request, bun) {
    const url    = new URL(request.url)
    const origin = request.headers.get('origin')

    if (request.method === 'OPTIONS')
      // 204 means no body, and `json()` would send one. Nothing preflights the
      // two plain GETs left here, but a malformed response is worse than none.
      return new Response(null, { status: 204, headers: corsHeaders() })

    if (url.pathname === '/health')
      return json({
        ok:      true,
        uptime:  now() - startedAt,
        lobbies: lobbies.size,
        matches: matchmaker.list(),
        rooms:   registry.list().map(room => ({
          id:      room.id,
          tick:    room.tick,
          humans:  room.humanCount,
          players: room.sim.players.length,
          rewind:  room.rewindDepth,
        })),
        // Surfaced rather than swallowed: an overflow means the sim dropped
        // wall-clock time, which every client reads as a stall.
        loop: registry.loop.stats,
      })

    // Auth is not here any more; it is same-origin on the Next app. This is
    // still the only place that can answer /api/matches, which is live
    // matchmaker memory rather than anything in a database.
    if (url.pathname === '/api/matches')
      return json({ matches: matchmaker.list() })

    if (url.pathname === '/battle' || url.pathname === '/lobby') {
      if (!originAllowed(origin, config.originAllowlist))
        return new Response('forbidden origin', { status: 403 })

      const data: SocketData | LobbySocket = url.pathname === '/battle'
        ? {
          kind:   'battle',
          room:   null,
          client: null,
          roomId: url.searchParams.get('match') ?? '',
          bucket: createBucket(now()),
        }
        : {
          playerId: crypto.randomUUID(),
          name:     'Pilot',
          account:  null,
          matchId:  null,
          bucket:   createBucket(now()),
          // Replaced with a real sink on open; a socket cannot send before it
          // exists.
          sink:     { send: () => {}, close: () => {} },
        }

      if (bun.upgrade(request, { data }))
        return undefined
      return new Response('expected a websocket upgrade', { status: 426 })
    }

    return new Response('not found', { status: 404 })
  },

  websocket: {
    maxPayloadLength: MAX_MESSAGE_BYTES,

    // Bun buffers per socket; a client that stops reading must not be allowed
    // to grow that buffer without bound while snapshots keep arriving.
    backpressureLimit:        1024 * 1024,
    closeOnBackpressureLimit: true,

    open (ws: ServerWebSocket<SocketData | LobbySocket>) {
      if (!isLobby(ws.data))
        return

      ws.data.sink = {
        send: (message: LobbyServerMessage) => {
          ws.send(jsonCodec.encode(message as never))
        },
        close: (code: number, reason: string) => ws.close(code, reason),
      }
      lobbies.add(ws.data)
    },

    async message (ws: ServerWebSocket<SocketData | LobbySocket>, raw) {
      try {
        if (isLobby(ws.data)) {
          await routeLobbyMessage(raw, ws.data, { matchmaker, store, now, sockets: lobbies })
          return
        }

        const sink = {
          send: (message: ServerMessage) => {
            ws.send(jsonCodec.encode(message))
          },
          close: (code: number, reason: string) => ws.close(code, reason),
        }

        await routeMessage(raw, ws.data, sink, {
          config,
          registry,
          now,
          redeemTicket: token => {
            const ticket = matchmaker.redeem(token)
            return ticket ? { matchId: ticket.matchId, name: ticket.name } : null
          },
        })
      }
      catch (error) {
        // One socket's bad turn must never take the process — and with it every
        // other live match — down with it.
        console.error('[battle] route failed', error)
      }
    },

    close (ws: ServerWebSocket<SocketData | LobbySocket>) {
      if (isLobby(ws.data)) {
        dropLobbySocket(ws.data, { matchmaker, store, now, sockets: lobbies })
        return
      }

      const { room, client } = ws.data
      if (!room || !client)
        return

      // Held, not removed: the ship stays in the world for the grace window so a
      // player who drops mid-fight comes back to it instead of a respawn.
      room.markDisconnected(client.playerId)
      room.broadcastRoster()
    },
  },
})

function isLobby (data: SocketData | LobbySocket): data is LobbySocket {
  return !('kind' in data)
}

console.info(
  `[battle] listening on ${config.host}:${config.port} · ` +
  `${config.tickHz} Hz sim · ${config.snapshotHz} Hz snapshots · ` +
  `store ${storeDescription()} · ` +
  `dev commands ${config.devCommands ? 'on' : 'off'}`
)

// Worth saying out loud: tokens are minted by the Next app's /api/auth, so if
// the two processes are not looking at the same database, every sign-in still
// *works* and every lobby connection still lands as a guest. That is a
// confusing enough failure to deserve a line at boot.
if (storeDescription() !== 'in-memory' && !process.env.DATABASE_URL)
  console.info('[battle] no DATABASE_URL: sessions issued by the Next app are not in this store, so everyone joins as a guest')

function shutdown (signal: string): void {
  console.info(`[battle] ${signal}, draining`)
  for (const room of registry.list())
    room.broadcast({ type: 'error', code: 'shutting-down', message: 'server is restarting' })

  registry.shutdown()
  store.close()
  server.stop(true)
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

export { CLOSE_SHUTDOWN }
