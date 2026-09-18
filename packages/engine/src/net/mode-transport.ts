/**
 * Shared skeleton behind `RaceTransport` and `BattleTransport` (ledger 2.1).
 *
 * Both transports wrap the same `RoomLink` and differ only in the schema
 * hanging off `state` and how the two channels join back into one view — see
 * `race/transport.ts` and `battle/transport.ts`'s own docs for that half.
 * What lived here twice, byte for byte:
 *
 * 1. Ten one-line delegates onto `RoomLink` (`close`, `flushInput`,
 *    `unacknowledged`, `renderTimeMs`, `serverTick`, `serverAck`,
 *    `drainEvents`, `noteCorrection`, `stats`, `clock`). `connect` and
 *    `pushInput` stay on each mode: their PAYLOAD shape (and, for
 *    `pushInput`, the input type and wire converter) is mode-specific even
 *    though the method name is not.
 * 2. `localId`'s scan, which only ever differed by which roster field it
 *    walked (`racers` vs `players`).
 * 3. `frame()`'s memoised merge: "same snapshot's `ships` array, same schema
 *    version → same object back", plus the poses-by-netIndex scratch map and
 *    the remotes-join loop underneath it.
 *
 * Composition was the other option and lost: every one of the ten delegates
 * would still need a one-line forward in each transport to reach a composed
 * "netcode" field, which is exactly the duplication this exists to remove.
 * Inheritance gives them for free. `frame()` is a genuine template method —
 * same cache check, same join loop, different entity shape and different
 * extra fields per mode — so it is an abstract `buildFrame` hook rather than
 * a callback threaded through a standalone helper.
 *
 * Kept deliberately OUT: the entity-by-id/by-netIndex maps a mode's roster
 * builds (`racersById` / `playersById` and their netIndex twins). Their
 * TYPES are shared in shape but not in identity requirements — see the
 * retention-audit comments in each transport's `buildFrame` for which of
 * those are safe to reuse in place and which are not — so unifying them here
 * would either force the unsafe case into reuse or the safe case out of it.
 * `remotesById` / `remotesByNetIndex` HAVE no such conflict (nothing outside
 * either transport reads them by name in either mode) and live here.
 */

import { RoomLink } from './room-link'

import type { NetStats, RemoteShip } from './room-link'
import type { InputFrame, ShipState, Snapshot } from 'Ξ'


/**
 * The slice of `RoomLink` this base (and its subclasses) actually call.
 *
 * Not `RoomLink<TState, TEvent>` itself: a class with private fields can only
 * be satisfied by another instance of that same class, so typing `link`
 * against the concrete class would make it impossible to hand a test a plain
 * fake. `Pick` drops the private brand and keeps the base testable without
 * booting a Colyseus room — see `mode-transport.test.ts`.
 */
export type LinkLike<TState extends object, TEvent> = Pick<RoomLink<TState, TEvent>,
  | 'clock' | 'connect' | 'close' | 'localNowMs' | 'pushInput' | 'flush' | 'unacknowledged'
  | 'renderTimeMs' | 'serverTick' | 'serverAck' | 'drainEvents' | 'noteCorrection' | 'stats'
  | 'state' | 'stateVersion' | 'latest' | 'netIndex' | 'remotes'>

/**
 * `TState`/`TEvent` — the room's Schema state and reliable-channel event.
 * `TView` — what `latest()` promises (no Maps; matches the original
 *   `RaceView`/`BattleView` split from `frame()`'s fuller `RaceFrame`/
 *   `BattleFrame`, which is why `latest()` and `frame()` keep different
 *   declared return types below exactly as they did before this existed).
 * `TFrame` — what `frame()` returns: `TView` plus the joined Maps and `local`.
 * `TLocalView` — the local seat's entry in the roster (`ViewRacer`/`ViewPlayer`).
 * `TNetEntity` — one joined remote (`NetRacer`/`NetRemote`).
 */
export abstract class ModeTransportBase<
  TState extends object,
  TEvent,
  TView,
  TFrame extends TView & { local: TLocalView | null; remotes: readonly TNetEntity[] },
  TLocalView,
  TNetEntity extends { id: string },
> {
  protected readonly link: LinkLike<TState, TEvent>

  // Local scratch for `refillPoses` — never appears in a returned frame, so
  //  nothing outside `buildFrame` can be holding a stale reference to it.
  private readonly posesScratch = new Map<number, ShipState>()

  // Reused in place by `joinRemotes`. Safe for both modes: neither transport's
  //  own callers (checked against `packages/game` and the rest of `engine`)
  //  read `remotesById` / `remotesByNetIndex` by name at all, let alone across
  //  a tick boundary — only the `remotes` ARRAY and `local` are ever read off
  //  a frame that outlives the call that produced it.
  protected readonly remotesById       = new Map<string, TNetEntity>()
  protected readonly remotesByNetIndex = new Map<number, TNetEntity>()

  private cachedFrame:   TFrame | null = null
  private cachedShips:   readonly ShipState[] | null = null
  private cachedVersion = -1

  constructor (link: LinkLike<TState, TEvent> = new RoomLink<TState, TEvent>()) {
    this.link = link
  }

  get clock () {
    return this.link.clock
  }

  close (): void {
    this.link.close()
  }

  flushInput (interpTick: number): void {
    this.link.flush(interpTick)
  }

  unacknowledged (): readonly InputFrame[] {
    return this.link.unacknowledged()
  }

  renderTimeMs (): number {
    return this.link.renderTimeMs()
  }

  serverTick (): number {
    return this.link.serverTick()
  }

  serverAck (): number {
    return this.link.serverAck()
  }

  drainEvents (): TEvent[] {
    return this.link.drainEvents()
  }

  noteCorrection (metres: number): void {
    this.link.noteCorrection(metres)
  }

  stats (): NetStats {
    return this.link.stats()
  }

  /** The roster to scan for the local seat's id — race's `racers`, battle's `players`. */
  protected abstract rosterEntries (): Iterable<[string, { netIndex: number }]>

  localId (): string | null {
    const index = this.link.netIndex
    if (index < 0)
      return null

    for (const [ id, entry ] of this.rosterEntries())
      if (entry.netIndex === index)
        return id
    return null
  }

  localState (): TLocalView | null {
    return this.frame()?.local ?? null
  }

  remotes (): readonly TNetEntity[] {
    return this.frame()?.remotes ?? []
  }

  /**
   * Build one fresh frame from the current schema state and snapshot.
   *
   * Called only when `frame()` has already decided the cached one is stale —
   * every mode-specific field (race's laps and gates, battle's health,
   * weapons, zones, flags and beams) is built in here, in each subclass.
   */
  protected abstract buildFrame (state: TState, snapshot: Snapshot | null): TFrame

  /**
   * Join the two channels once per binary snapshot or Schema patch. Calls in
   * between return the same read-only frame and indexes.
   *
   * The cache key is the snapshot's `ships` array identity plus the Schema
   * patch counter (`RoomLink.stateVersion`) — `decodeSnapshot` hands back a
   * new `ships` array only when a packet actually changed poses, and
   * `stateVersion` only advances on `onStateChange`, so "both unchanged"
   * really does mean nothing this frame could show has moved.
   */
  frame (): TFrame | null {
    const state = this.link.state
    if (!state)
      return null

    const snapshot = this.link.latest()
    // Normalise before comparing: with no snapshot yet `snapshot?.ships` is
    // undefined while the cache holds null, and that mismatch would rebuild
    // the frame every call until the first packet lands.
    const ships = snapshot?.ships ?? null
    if (this.cachedFrame && this.cachedShips === ships && this.cachedVersion === this.link.stateVersion)
      return this.cachedFrame

    const frame = this.buildFrame(state, snapshot)

    this.cachedFrame   = frame
    this.cachedShips   = ships
    this.cachedVersion = this.link.stateVersion
    return frame
  }

  latest (): TView | null {
    return this.frame()
  }

  /** `poses`, keyed by netIndex — cleared and refilled in place every rebuild. */
  protected refillPoses (snapshot: Snapshot | null): ReadonlyMap<number, ShipState> {
    this.posesScratch.clear()
    for (const ship of snapshot?.ships ?? [])
      this.posesScratch.set(ship.id, ship)
    return this.posesScratch
  }

  /**
   * Join `RoomLink.remotes()` against this tick's roster by net index.
   *
   * `remotesById` / `remotesByNetIndex` are cleared and refilled in place
   * (see the class doc for why that is safe); `join`'s own return value is a
   * fresh object every time, same as before — only the two Maps collecting
   * it are reused.
   */
  protected joinRemotes<TEntity> (
    byNetIndex: ReadonlyMap<number, TEntity>,
    join: (entity: TEntity, remote: RemoteShip) => TNetEntity,
  ): TNetEntity[] {
    this.remotesById.clear()
    this.remotesByNetIndex.clear()

    const list: TNetEntity[] = []
    for (const remote of this.link.remotes()) {
      const entity = byNetIndex.get(remote.netIndex)
      if (!entity)
        continue

      const joined = join(entity, remote)
      list.push(joined)
      this.remotesById.set(joined.id, joined)
      this.remotesByNetIndex.set(remote.netIndex, joined)
    }
    return list
  }
}
