/**
 * The room is where an untrusted, lossy input stream becomes one authoritative
 * timeline, so the cases that matter are the lossy ones: re-sent bundles,
 * gaps, floods and silence.
 *
 * Everything here drives `room.step()` directly. The loop that normally calls
 * it is wall-clock scheduling and is tested separately.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { BattleRoom } from '../src/match/room'
import type { RoomClient } from '../src/match/room'
import type { InputFrame, InputPacket, ServerMessage } from 'Δengine/battle/protocol'


const frame = (seq: number, over: Partial<InputFrame> = {}): InputFrame => ({
  seq,
  clientTick: seq,
  steer:      0,
  throttle:   true,
  brake:      false,
  boost:      false,
  fire:       false,
  resetSeq:   0,
  ...over,
})

const bundle = (frames: InputFrame[], interpTick = 0): InputPacket => ({
  type:            'input',
  frames,
  lastAckSnapshot: 0,
  interpTick,
})

function makeRoom (over: Partial<Parameters<typeof BattleRoom.create>[0]> = {}) {
  return BattleRoom.create({
    id:         'test',
    tickHz:     60,
    snapshotHz: 30,
    maxPlayers: 16,
    backfill:   { minPlayers: 2, enabled: true },
    ...over,
  })
}

describe('BattleRoom', () => {
  let room: BattleRoom
  let sent: ServerMessage[]
  let client: RoomClient

  beforeEach(async () => {
    room = await makeRoom()
    sent = []

    const result = room.join('Pilot', 'icaras', m => sent.push(m))
    expect(result.ok).toBe(true)
    if (!result.ok)
      throw new Error('join failed')
    client = result.client
    sent.length = 0
  })

  describe('input acknowledgement', () => {
    it('consumes frames in order and echoes the highest applied seq', () => {
      room.acceptInput(client.playerId, bundle([ frame(1), frame(2), frame(3) ]))

      // Three queued is already over the target buffer, so the first tick
      // drains two to catch up rather than letting the backlog settle in as
      // permanent latency.
      room.step(1 / 60)
      expect(client.lastProcessedInput).toBe(2)

      room.step(1 / 60)
      expect(client.lastProcessedInput).toBe(3)
    })

    it('ignores frames a re-sent bundle has already delivered', () => {
      room.acceptInput(client.playerId, bundle([ frame(1), frame(2) ]))
      room.step(1 / 60)
      room.step(1 / 60)
      expect(client.lastProcessedInput).toBe(2)

      // The whole point of bundling: the client keeps re-sending its
      // unacknowledged tail, and the room must not replay what it consumed.
      room.acceptInput(client.playerId, bundle([ frame(1), frame(2), frame(3) ]))
      room.step(1 / 60)
      expect(client.lastProcessedInput).toBe(3)
    })

    it('holds the last frame when the queue starves', () => {
      room.acceptInput(client.playerId, bundle([ frame(7, { boost: true }) ]))
      room.step(1 / 60)
      expect(client.lastProcessedInput).toBe(7)

      // A lost packet should read as "still holding boost", not "let go".
      room.step(1 / 60)
      room.step(1 / 60)
      expect(client.lastProcessedInput).toBe(7)
      expect(room.sim.getPlayer(client.playerId)?.controls.boost).toBe(true)
    })

    it('drops the oldest frames when a client floods', () => {
      const flood = Array.from({ length: 32 }, (_, i) => frame(i + 1))
      room.acceptInput(client.playerId, bundle(flood.slice(0, 16)))
      room.acceptInput(client.playerId, bundle(flood.slice(16)))

      // Bounded replay: the room plays the present, not a backlog.
      room.step(1 / 60)
      expect(client.lastProcessedInput).toBeGreaterThan(1)
    })

    it('records the tick a shooter was rendering, for lag compensation', () => {
      room.acceptInput(client.playerId, bundle([ frame(1) ], 42))
      expect(client.interpTick).toBe(42)
    })
  })

  describe('broadcast cadence', () => {
    it('sends a snapshot every second tick at 30 Hz over a 60 Hz sim', () => {
      const states = () => sent.filter(m => m.type === 'state')

      room.step(1 / 60)
      expect(states()).toHaveLength(0)

      room.step(1 / 60)
      expect(states()).toHaveLength(1)

      room.step(1 / 60)
      room.step(1 / 60)
      expect(states()).toHaveLength(2)
    })

    it('stamps each client with its own acknowledgement', () => {
      room.acceptInput(client.playerId, bundle([ frame(5) ]))
      room.step(1 / 60)
      room.step(1 / 60)

      const state = sent.find(m => m.type === 'state')
      expect(state).toBeDefined()
      if (state?.type === 'state') {
        expect(state.lastProcessedInput).toBe(5)
        expect(state.serverTick).toBe(2)
        expect(state.snapshot.players.length).toBeGreaterThan(0)
      }
    })
  })

  describe('roster', () => {
    it('backfills bots up to the target and evicts them as humans arrive', () => {
      // minPlayers 2, one human → one bot.
      expect(room.sim.players.filter(p => p.isBot)).toHaveLength(1)

      room.join('Second', 'icaras', () => {})
      expect(room.humanCount).toBe(2)
      expect(room.sim.players.filter(p => p.isBot)).toHaveLength(0)
    })

    it('refills bots when a human leaves', () => {
      const second = room.join('Second', 'icaras', () => {})
      expect(second.ok).toBe(true)
      if (!second.ok)
        return

      room.leave(second.client.playerId)
      expect(room.humanCount).toBe(1)
      expect(room.sim.players.filter(p => p.isBot)).toHaveLength(1)
    })

    it('refuses a join past the player cap', async () => {
      const tiny = await makeRoom({ maxPlayers: 1, backfill: { minPlayers: 1, enabled: false }})
      tiny.join('One', 'icaras', () => {})

      const result = tiny.join('Two', 'icaras', () => {})
      expect(result.ok).toBe(false)
      if (!result.ok)
        expect(result.reason).toBe('room-full')

      tiny.dispose()
    })
  })

  describe('disconnection', () => {
    it('neutralises controls so a dropped ship does not fly on', () => {
      room.acceptInput(client.playerId, bundle([ frame(1, { throttle: true, steer: 1 }) ]))
      room.step(1 / 60)
      expect(room.sim.getPlayer(client.playerId)?.controls.throttle).toBe(true)

      room.markDisconnected(client.playerId)
      expect(room.sim.getPlayer(client.playerId)?.controls.throttle).toBe(false)
      expect(room.sim.getPlayer(client.playerId)?.controls.steer).toBe(0)
    })

    it('keeps the ship alive through the grace window, then reaps it', () => {
      room.markDisconnected(client.playerId)

      // A generous window keeps the ship, so a player who drops mid-fight comes
      // back to it rather than to a respawn.
      expect(room.reapDisconnected(60_000)).toHaveLength(0)
      expect(room.sim.getPlayer(client.playerId)).toBeDefined()

      // A window already elapsed evicts it.
      expect(room.reapDisconnected(-1)).toContain(client.playerId)
      expect(room.sim.getPlayer(client.playerId)).toBeUndefined()
    })

    it('hands the same ship back on resume', () => {
      const session = client.session
      room.markDisconnected(client.playerId)

      const resumed = room.resume(session, () => {})
      expect(resumed?.playerId).toBe(client.playerId)
      expect(resumed?.connected).toBe(true)
    })

    it('refuses a resume for a session that is still connected', () => {
      expect(room.resume(client.session, () => {})).toBeNull()
    })
  })
})
