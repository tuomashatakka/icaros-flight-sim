/**
 * `ModeTransportBase.frame()`'s memoised merge — the one piece of behaviour
 * this shared base owns outright rather than forwarding onto `RoomLink`.
 * Everything else on it is a one-line delegate, already exercised through the
 * real transports by `prediction.test.ts` (a real race room) and
 * `room-link.test.ts`.
 *
 * The fake link below only implements what the memo check and this test's
 * own `buildFrame` touch (`state`, `stateVersion`, `latest`); every other
 * member is typed `never` and never called.
 */

import { describe, expect, it } from 'vitest'

import { ModeTransportBase } from 'Σnet/mode-transport'

import type { LinkLike } from 'Σnet/mode-transport'


type FakeState = { seat: string }
type FakeShips = readonly unknown[]
type FakeView  = { builds: number }
type FakeFrame = FakeView & { local: null; remotes: readonly never[] }

function fakeLink (state: FakeState | null) {
  const link = {
    clock:          undefined as never,
    connect:        undefined as never,
    close:          undefined as never,
    localNowMs:     undefined as never,
    pushInput:      undefined as never,
    flush:          undefined as never,
    unacknowledged: undefined as never,
    renderTimeMs:   undefined as never,
    serverTick:     undefined as never,
    serverAck:      undefined as never,
    drainEvents:    undefined as never,
    noteCorrection: undefined as never,
    stats:          undefined as never,
    netIndex:       undefined as never,
    remotes:        undefined as never,

    state,
    stateVersion: 0,
    ships:        null as FakeShips | null,

    // Cast rather than typed as `Snapshot`: this fake never decodes a real
    //  packet, and `frame()` only ever reads `.ships` off whatever comes back.
    latest () {
      return this.ships === null ? null : ({ ships: this.ships } as never)
    },
  }
  return link
}

/** A minimal concrete mode: `buildFrame` just counts how often it runs. */
class TestTransport extends ModeTransportBase<FakeState, never, FakeView, FakeFrame, null, { id: string }> {
  builds = 0

  protected rosterEntries (): Iterable<[string, { netIndex: number }]> {
    return []
  }

  protected buildFrame (): FakeFrame {
    this.builds++
    return { builds: this.builds, local: null, remotes: [] }
  }
}

describe('ModeTransportBase.frame()', () => {
  it('returns the cached frame until the snapshot and the schema version both hold still', () => {
    const link      = fakeLink({ seat: 'p1' })
    const transport = new TestTransport(link)

    const first = transport.frame()
    expect(transport.builds).toBe(1)

    // Nothing moved — a second (and third) call must not rebuild.
    expect(transport.frame()).toBe(first)
    expect(transport.frame()).toBe(first)
    expect(transport.builds).toBe(1)
  })

  it('rebuilds when the snapshot changes, and again when the schema version does', () => {
    const link      = fakeLink({ seat: 'p1' })
    const transport = new TestTransport(link)

    const first = transport.frame()

    link.ships   = [ {} ]
    const second = transport.frame()
    expect(second).not.toBe(first)
    expect(transport.builds).toBe(2)

    // Settles again once the new snapshot is the one being compared against.
    expect(transport.frame()).toBe(second)
    expect(transport.builds).toBe(2)

    link.stateVersion = 1
    const third       = transport.frame()
    expect(third).not.toBe(second)
    expect(transport.builds).toBe(3)
  })

  it('returns null without building when there is no schema state yet', () => {
    const transport = new TestTransport(fakeLink(null))

    expect(transport.frame()).toBeNull()
    expect(transport.builds).toBe(0)
  })
})
