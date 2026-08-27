/**
 * The Crash Velocity battle server.
 *
 * A persistent, stateful process: it holds every live match in memory and steps
 * them at a fixed rate. That is exactly what a serverless host cannot run, and
 * why this is a separate app rather than a Next.js route — the client stays on
 * whatever static host it likes and connects here over a WebSocket.
 *
 *     bun run dev:server
 *
 * Nothing here is host-specific. Every knob is an environment variable with a
 * localhost default (see `config.ts`).
 */

import { loadConfig } from './config'
import { createRegistry } from './match/registry'
import { CLOSE_SHUTDOWN, routeMessage } from './net/battle-socket'
import { MAX_MESSAGE_BYTES, createBucket, originAllowed } from './net/session'
import { jsonCodec } from 'Δengine/battle/protocol'
import type { SocketData } from './net/session'
import type { ServerMessage } from 'Δengine/battle/protocol'
import type { ServerWebSocket } from 'bun'


const config    = loadConfig()
const registry  = createRegistry(config)
const now       = () => Date.now()
const startedAt = now()

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const server = Bun.serve<SocketData, never>({
  hostname: config.host,
  port:     config.port,

  fetch (request, bun) {
    const url    = new URL(request.url)
    const origin = request.headers.get('origin')

    if (url.pathname === '/health')
      return json({
        ok:     true,
        uptime: now() - startedAt,
        rooms:  registry.list().map(room => ({
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

    if (url.pathname === '/battle') {
      if (!originAllowed(origin, config.originAllowlist))
        return new Response('forbidden origin', { status: 403 })

      const data: SocketData = {
        kind:   'battle',
        room:   null,
        client: null,
        roomId: url.searchParams.get('match') ?? '',
        bucket: createBucket(now()),
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

    async message (ws: ServerWebSocket<SocketData>, raw) {
      const sink = {
        send: (message: ServerMessage) => {
          ws.send(jsonCodec.encode(message))
        },
        close: (code: number, reason: string) => ws.close(code, reason),
      }

      try {
        await routeMessage(raw, ws.data, sink, { config, registry, now })
      }
      catch (error) {
        // One socket's bad turn must never take the process — and with it every
        // other live match — down with it.
        console.error('[battle] route failed', error)
        sink.send({ type: 'error', code: 'bad-message', message: 'internal error' })
      }
    },

    close (ws: ServerWebSocket<SocketData>) {
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

console.info(
  `[battle] listening on ${config.host}:${config.port} · ` +
  `${config.tickHz} Hz sim · ${config.snapshotHz} Hz snapshots · ` +
  `dev commands ${config.devCommands ? 'on' : 'off'}`
)

function shutdown (signal: string): void {
  console.info(`[battle] ${signal}, draining`)
  for (const room of registry.list())
    room.broadcast({ type: 'error', code: 'shutting-down', message: 'server is restarting' })

  registry.shutdown()
  server.stop(true)
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

export { CLOSE_SHUTDOWN }
