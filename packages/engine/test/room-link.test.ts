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

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Set by a test to decide how the join goes. */
let joinFailure: Error | null = null

vi.mock('@colyseus/sdk', () => ({
  Client: class {
    auth = { token: '' }
    async joinOrCreate () {
      if (joinFailure)
        throw joinFailure
      return { onMessage: () => {}, onStateChange: () => {}, send: () => {}, leave: async () => {} }
    }
  },
}))

const { RoomLink } = await import('Σnet/room-link')

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
