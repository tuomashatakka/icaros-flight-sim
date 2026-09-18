/**
 * What happens when the game server is not there.
 *
 * Every mode is network-only, so this is not an edge case — it is the default
 * experience of any deployment whose `NEXT_PUBLIC_GAME_SERVER_URL` is unset,
 * and of every player whose connection drops on the way in.
 *
 * It used to be invisible. Both transports call `connect()` as
 * `void link.connect(...)`, so a rejecting promise became an unhandled
 * rejection that reached no UI at all: race sat on its initial `lobby` status
 * with a motionless ship, and battle showed `SYNCING` — the same thing a
 * healthy handshake shows — for as long as the tab stayed open.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RECONNECT_GRACE_SEC, encodeSnapshot } from 'Ξ'

/** Set by a test to decide how the join goes. */
let joinFailure: Error | null = null

vi.mock('@colyseus/sdk', () => ({
  Client: class {
    auth = { token: '' }
    async joinOrCreate () {
      if (joinFailure)
        throw joinFailure
      return { onMessage: () => {}, onStateChange: () => {}, onLeave: () => {}, send: () => {}, leave: async () => {} }
    }
  },
  // `RoomLink` compares against `CloseCode.CONSENTED`; a mock that omits it
  //  leaves that import `undefined` and `handleLeave` throws the moment
  //  ANY test in this file drops a room, including the join-failure ones above.
  CloseCode: { CONSENTED: 4000 },
}))

const { RoomLink, MessageKind } = await import('Σnet/room-link')

// A URL with a scheme takes `resolveServerUrl`'s override path, so the test
// never touches `location` — which does not exist under the node environment.
const SERVER = 'ws://127.0.0.1:1'

const link = () => new RoomLink() as InstanceType<typeof RoomLink>

const join = (instance: ReturnType<typeof link>) =>
  instance.connect({ room: 'race', state: class {} as never, options: {}, server: SERVER })

beforeEach(() => {
  joinFailure = null
})

describe('room link', () => {
  it('reports an unreachable server instead of rejecting into nowhere', async () => {
    joinFailure = new Error('WebSocket connection failed')

    const instance = link()
    await expect(join(instance)).resolves.toBeUndefined()

    const { linkError } = instance.stats()
    expect(linkError).toContain('WebSocket connection failed')

    // The URL is the half that is usually wrong, and the SDK's own message
    //  never says which server it tried.
    expect(linkError).toContain(SERVER)
  })

  it('leaves the error null on a join that lands', async () => {
    const instance = link()
    await join(instance)
    expect(instance.stats().linkError).toBeNull()
  })

  it('clears a previous failure when the link is closed', async () => {
    joinFailure = new Error('nope')

    const instance = link()
    await join(instance)
    expect(instance.stats().linkError).not.toBeNull()

    instance.close()
    expect(instance.stats().linkError).toBeNull()
  })
})

/**
 * A room object shaped exactly as `bindRoom` needs it, plus hooks a test can
 * fire by hand — the stand-in for a socket these tests never open.
 */
function fakeRoom (reconnectionToken: string) {
  const messageHandlers = new Map<string, (payload: never) => void>()
  let leaveHandler: ((code: number, reason?: string) => void) | null = null

  const room = {
    sessionId:    'sess-1',
    reconnectionToken,
    state:        {},
    reconnection: { enabled: true },
    onMessage:    (type: string, cb: (payload: never) => void) => {
      messageHandlers.set(type, cb)
    },
    onStateChange: () => {},
    onLeave:       (cb: (code: number, reason?: string) => void) => {
      leaveHandler = cb
    },
    send:  () => {},
    leave: async () => {},
  }

  return {
    room,
    fireMessage: (type: string, payload: unknown) => messageHandlers.get(type)?.(payload as never),
    fireLeave:   (code: number, reason?: string) => leaveHandler?.(code, reason),
  }
}

describe('room link reconnection', () => {
  const STATE_CTOR = class {} as never

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reconnects after a drop: reconnecting -> reconnect(token) -> rebound -> connected', async () => {
    const first                     = fakeRoom('room-1:token-1')
    const second                    = fakeRoom('room-1:token-2')
    const reconnectTokens: string[] = []

    const client = {
      auth:         { token: '' },
      joinOrCreate: async () => first.room,
      reconnect:    async (token: string) => {
        reconnectTokens.push(token)
        return second.room
      },
    }

    const instance = new RoomLink()
    await instance.connect({ room: 'race', state: STATE_CTOR, options: {}, server: SERVER, clientFactory: () => client as never })

    first.fireLeave(1006, 'abnormal closure')
    expect(instance.stats().linkState).toBe('reconnecting')

    // The ~500 ms initial backoff, plus room for the `reconnect()` microtasks
    //  `advanceTimersByTimeAsync` drains alongside it.
    await vi.advanceTimersByTimeAsync(600)

    expect(reconnectTokens).toEqual([ 'room-1:token-1' ])
    expect(instance.stats().linkState).toBe('connected')
    expect(instance.stats().linkError).toBeNull()

    // Handlers were rebound on `second`, not left behind on `first`: a
    //  SNAPSHOT delivered to the NEW room has to reach `applySnapshot`.
    const snapshot = encodeSnapshot({ serverTick: 7, serverTimeMs: Date.now(), baselineTick: 0, lastProcessedInput: 0, ships: [], removed: []}, null)
    second.fireMessage(MessageKind.SNAPSHOT, snapshot)
    expect(instance.latest()?.serverTick).toBe(7)
  })

  it('does not reconnect once closed, even if the old room reports a late drop', async () => {
    const first     = fakeRoom('room-1:token-1')
    const reconnect = vi.fn(async () => {
      throw new Error('close() should have suppressed this before it was ever called')
    })
    const client = { auth: { token: '' }, joinOrCreate: async () => first.room, reconnect }

    const instance = new RoomLink()
    await instance.connect({ room: 'race', state: STATE_CTOR, options: {}, server: SERVER, clientFactory: () => client as never })

    instance.close()
    first.fireLeave(1006, 'abnormal closure')
    await vi.advanceTimersByTimeAsync(RECONNECT_GRACE_SEC * 1000 + 1000)

    expect(reconnect).not.toHaveBeenCalled()
    expect(instance.stats().linkState).toBe('idle')
  })

  it('gives up once RECONNECT_GRACE_SEC has passed, and names the reason', async () => {
    const first  = fakeRoom('room-1:token-1')
    const client = {
      auth:         { token: '' },
      joinOrCreate: async () => first.room,
      reconnect:    async () => {
        throw new Error('server unreachable')
      },
    }

    const instance = new RoomLink()
    await instance.connect({ room: 'race', state: STATE_CTOR, options: {}, server: SERVER, clientFactory: () => client as never })

    first.fireLeave(1006, 'abnormal closure')
    // Comfortably past the grace window: every backoff step (500 ms doubling,
    //  capped at 4 s) has to have run out by here.
    await vi.advanceTimersByTimeAsync(RECONNECT_GRACE_SEC * 1000 + 2000)

    const stats = instance.stats()
    expect(stats.linkState).toBe('lost')
    expect(stats.linkError).toContain('LINK LOST')
  })
})
