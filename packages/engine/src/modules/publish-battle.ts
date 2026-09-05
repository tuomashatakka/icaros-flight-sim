/**
 * Owns every `battleActions.*` call the battle scene makes.
 *
 * Sim outputs reach the stores only through a publish module, on the publish
 * cadence — `publish.ts` is the gameplay store's version of this file, and
 * `telemetry-publish.ts` battle's telemetry one. This is battle's HUD
 * counterpart: the quantised readouts (lock, pilot, weapons, chrome, net
 * health, aim) commit on the same cadence the scene always ran them at — every
 * tick, the same as before this file existed — and rely on `battleActions`'
 * own thresholds to keep a 60 Hz call from forcing 60 React commits. Edge
 * events (kills and other feed entries, a fatal link error, the match reset on
 * mount) flush the moment they happen, exactly the way `publish.ts` flushes a
 * crash rather than waiting for a period to elapse.
 */

import { IDLE_LOCK, battleActions, battleStore } from 'Ƨ'
import { DEFAULT_BATTLE_CONFIG } from 'Ψsim'
import { WEAPONS } from 'Ψweapons'

import type { BattleArena } from 'Ψarena'
import type { BattleEvent } from 'Ψtypes'
import type { Loadout } from 'Ψweapons'
import type { BattleFrame, BattleTransport, ViewPlayer } from '../battle/transport'


export type BattlePublisherDeps = {
  transport: Pick<BattleTransport, 'stats' | 'drainEvents'>;
  arena:     BattleArena;
  loadout:   Loadout;
}

export type BattlePublisher = {

  /**
   * Publish this tick's readouts and flush any events since the last one.
   *
   * Net health and the aim commit run whether or not a snapshot has arrived
   * yet, exactly as the scene always ran them; everything else waits for
   * both. The returned events are for the CALLER — camera shake, the post
   * pulse — this has already written them into the store.
   */
  tick(aim: number, snapshot: BattleFrame | null, server: ViewPlayer | null): readonly BattleEvent[];
}

const NO_EVENTS: readonly BattleEvent[] = []

export function createBattlePublisher (deps: BattlePublisherDeps): BattlePublisher {
  const { transport, arena, loadout } = deps

  battleActions.resetSession()

  let lastAimCommit = -1

  /**
   * Zone views for the HUD.
   *
   * The snapshot carries zone ids and state but not display names — those
   * live in the arena, which the client has its own copy of. Joining them
   * here is why `setChrome` gets real names instead of the id fallback the
   * transport writes when it commits on its own.
   */
  function zoneViews (snapshot: BattleFrame) {
    return snapshot.zones.map(z => {
      const def = arena.controlPoints.find(c => c.id === z.id)
      return {
        id:        z.id,
        name:      def?.name ?? z.id,
        short:     def?.short ?? z.id.slice(0, 2).toUpperCase(),
        owner:     z.owner,
        progress:  z.progress,
        capturing: z.capturing,
        contested: z.contested,
      }
    })
  }

  /**
   * Publish connection health, and raise the alarm once if it is fatal.
   *
   * A join that never lands used to show `SYNCING` forever — the same thing a
   * healthy handshake shows. Battle already draws a full error overlay; it
   * just had nothing that could ever trigger it.
   */
  function reportNet (): void {
    const stats = transport.stats()
    const store = battleStore.get()
    battleActions.setNetStats(stats)

    if (stats.linkError && store.status !== 'error')
      battleActions.setError(`cannot reach the game server · ${stats.linkError}`)
  }

  /**
   * Push one snapshot into the HUD store.
   *
   * Every field here is the SERVER'S. Lock in particular: the server owns the
   * cone test, and a client that decided its own would disagree with the
   * authority about who it was shooting.
   */
  function publishHud (server: ViewPlayer, snapshot: BattleFrame): void {
    const target = server.lockTarget ? snapshot.playersById.get(server.lockTarget) : undefined

    if (target)
      battleActions.setLockOn({
        phase:    server.lockPhase,
        targetId: target.id,
        name:     target.name,
        distance: Math.hypot(target.x - server.x, target.y - server.y, target.z - server.z),
        team:     target.team,
        progress: server.lockMeter,
      })
    else
      battleActions.setLockOn(IDLE_LOCK)

    battleActions.setPilot({
      health:    server.health,
      maxHealth: server.maxHealth,
      boost:     server.boost,
      kills:     server.kills,
      deaths:    server.deaths,
      carrying:  snapshot.flagsByCarrierId.get(server.id)?.team ?? null,
    })

    const primarySpec   = WEAPONS[loadout.primary]
    const secondarySpec = WEAPONS[loadout.secondary]
    battleActions.setWeapons(
      { id: primarySpec.id, cooldown: server.primaryCd, needsLock: primarySpec.needsLock },
      { id: secondarySpec.id, cooldown: server.secondaryCd, needsLock: secondarySpec.needsLock }
    )

    battleActions.setChrome({
      status:      snapshot.status,
      countdown:   snapshot.countdown,
      timeLeft:    Math.round(snapshot.timeLeft),
      scores:      snapshot.scores,
      scoreTarget: DEFAULT_BATTLE_CONFIG.scoreTarget,
      zones:       zoneViews(snapshot),
      flags:       snapshot.flags.map(f => ({
        team:      f.team,
        state:     f.state,
        carrierId: f.carrierId,
      })),
    })
  }

  return {
    tick (aim, snapshot, server) {
      reportNet()

      // Quantised for the same reason the lock meter is: the trim integrates
      // every tick, and a React commit per 0.6 mrad of aim is 60 renders a
      // second.
      if (Math.abs(aim - lastAimCommit) > 0.01) {
        lastAimCommit = aim
        battleActions.setAimPitch(aim)
      }

      if (!snapshot || !server)
        return NO_EVENTS

      publishHud(server, snapshot)

      const events = transport.drainEvents()
      if (events.length) {
        const names = snapshot.namesById
        for (const event of events)
          battleActions.applyEvent(event, names)
      }
      return events
    },
  }
}
