/**
 * Every live room, and the one loop that ticks them.
 *
 * Deliberately a single shared loop rather than a timer per room: a hobby
 * server runs a handful of matches, and one timer means every room advances on
 * the same cadence and a slow tick is visible in one place instead of smeared
 * across N schedulers. It also makes shutdown a single stop.
 */

import { createLoop } from './loop'
import { BattleRoom } from './room'
import type { Loop } from './loop'
import type { ServerConfig } from '../config'


export type Registry = {
  readonly loop: Loop;

  /** The room every direct `/battle` connection lands in when none is named. */
  defaultRoom (): Promise<BattleRoom>;

  create (id?: string): Promise<BattleRoom>;
  get (id: string): BattleRoom | undefined;
  list (): BattleRoom[];
  close (id: string): void;
  shutdown (): void;
}

/** How often expired disconnections are swept, in ticks. */
const REAP_EVERY = 60

export function createRegistry (config: ServerConfig): Registry {
  const rooms = new Map<string, BattleRoom>()

  // In-flight creations, so two sockets arriving in the same tick cannot each
  // build a room for the same id — `BattleRoom.create` is async (rapier boots
  // its WASM), which is exactly the window where that race lives.
  const pending = new Map<string, Promise<BattleRoom>>()

  let sinceReap = 0
  let idSeq     = 0

  const loop = createLoop({
    hz:     config.tickHz,
    onTick: dt => {
      for (const room of rooms.values())
        room.step(dt)

      if (++sinceReap < REAP_EVERY)
        return
      sinceReap = 0

      for (const room of [ ...rooms.values() ]) {
        room.reapDisconnected(config.reconnectGraceSec * 1000)

        // An empty room still steps a full rapier world and its bots. Nothing
        // is watching, so close it.
        if (room.empty && room.uptimeMs > 10_000) {
          room.dispose()
          rooms.delete(room.id)
        }
      }
    },
  })

  function create (id?: string): Promise<BattleRoom> {
    const roomId   = id ?? `r${++idSeq}`
    const existing = rooms.get(roomId)
    if (existing)
      return Promise.resolve(existing)

    const inFlight = pending.get(roomId)
    if (inFlight)
      return inFlight

    const building = BattleRoom.create({
      id:         roomId,
      tickHz:     config.tickHz,
      snapshotHz: config.snapshotHz,
      maxPlayers: config.maxPlayers,
    }).then(room => {
      rooms.set(roomId, room)
      pending.delete(roomId)
      if (!loop.running)
        loop.start()
      return room
    })
      .catch(error => {
        pending.delete(roomId)
        throw error
      })

    pending.set(roomId, building)
    return building
  }

  return {
    loop,
    create,
    defaultRoom: () => create('main'),
    get:         id => rooms.get(id),
    list:        () => [ ...rooms.values() ],

    close (id) {
      const room = rooms.get(id)
      if (!room)
        return
      room.dispose()
      rooms.delete(id)
    },

    shutdown () {
      loop.stop()
      for (const room of rooms.values())
        room.dispose()
      rooms.clear()
    },
  }
}
