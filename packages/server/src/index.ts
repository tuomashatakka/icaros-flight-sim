/**
 * The authoritative game server.
 *
 * One Bun process, two room types, and everything that is not a simulation is
 * Colyseus's problem now: matchmaking, seat reservation, reconnection, the
 * patch cadence, room lifecycle and CORS. What used to be here — a hand-rolled
 * matchmaker, a ticket table, a `/lobby` protocol, a room registry and a
 * fixed-rate loop — is gone, and the rooms themselves live in
 * `@crash-velocity/race` and `@crash-velocity/battle` beside the simulations
 * they drive.
 *
 * It stays a separate process from the Next app on purpose. Vercel runs
 * short-lived stateless functions; this is a persistent in-memory simulation
 * stepping at 60 Hz and holding every player in a room. The client is deployed
 * there, this is deployed somewhere it can stay running, and they meet over a
 * WebSocket and a signed sixty-second ticket.
 */

import { Server, matchMaker } from '@colyseus/core'
import { BunWebSockets } from '@colyseus/bun-websockets'
import { BattleRoom } from 'Ψroom'
import { RaceRoom } from 'Λroom'
import { TRACK_IDS } from 'Λ'
import { describeDatabase, openDatabase, setDatabase } from 'Ð'

import { loadConfig } from './config'


const config = loadConfig()

/**
 * One database for the process, installed before any room can exist.
 *
 * `neon-ws` rather than `neon-http`: this is a long-lived process that would
 * rather pay the WebSocket handshake once than an HTTP round trip per query.
 * With no DATABASE_URL it falls back to PGlite, so a local server still records
 * matches — they just go away with the process.
 *
 * A database that cannot be opened is not fatal. Recording a scoreboard is not
 * worth refusing to host a game over; `withDatabase` degrades to a no-op and
 * says so on stderr.
 */
try {
  const handle = await openDatabase({ driver: process.env.DATABASE_URL ? 'neon-ws' : 'pglite' })
  setDatabase(handle.db)
}
catch (error) {
  process.stderr.write(`[server] no database, match history disabled: ${error instanceof Error ? error.message : error}\n`)
}

const transport = new BunWebSockets()
const server    = new Server({ transport, greet: false })

// `filterBy` is what makes `joinOrCreate('race', { trackId })` land everyone
// who asked for the same track in the same room, and start a new one for a
// track nobody is on. It replaces the entire hand-written matchmaker.
server.define('race', RaceRoom, { bots: config.raceGrid })
  .filterBy([ 'trackId' ])

server.define('battle', BattleRoom)
  .filterBy([ 'arenaId' ])

if (config.devTools) {
  // Mounted only outside production: the monitor exposes every room's live
  // state, and the playground will happily join one.
  const app                           = transport.getExpressApp()
  const [{ monitor }, { playground }] = await Promise.all([
    import('@colyseus/monitor'),
    import('@colyseus/playground'),
  ])
  app.use('/colyseus', monitor())
  app.use('/playground', playground())
}

/**
 * What is currently running.
 *
 * The lobby polls this rather than holding a socket open: a room list changes
 * when somebody starts a match — seconds apart, not frames — so a poll is the
 * right shape. The SDK's own `getAvailableRooms` was removed in 0.18, and one
 * endpoint we control is steadier than tracking where it went.
 */
transport.getExpressApp().get('/rooms', (_request, response) => {
  void matchMaker.query({}).then(rooms => {
    response.json({
      rooms: rooms.map(room => ({
        roomId:   room.roomId,
        name:     room.name,
        clients:  room.clients,
        locked:   room.locked,
        metadata: room.metadata ?? {},
      })),
    })
  })
})

transport.getExpressApp().get('/health', (_request, response) => {
  response.json({
    ok:     true,
    uptime: Math.round(process.uptime()),
    rooms:  matchMaker.stats.local,
    tracks: TRACK_IDS,
  })
})

await server.listen(config.port, config.host)

process.stdout.write(
  `game server on ${config.host}:${config.port}\n` +
  `  rooms    race, battle\n` +
  `  database ${describeDatabase()}\n` +
  (config.devTools ? `  devtools /colyseus, /playground\n` : ''),
)

// No SIGINT/SIGTERM handler here on purpose: `Server` installs its own, and a
// second one racing it produced `already_shutting_down` on every stop.
