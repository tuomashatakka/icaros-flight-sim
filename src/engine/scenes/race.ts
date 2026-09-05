/**
 * The race scene.
 *
 * Network-backed, and structurally battle's twin. Race used to simulate itself:
 * one rapier body stepped by a module, lap rules in a zustand store, and gates
 * as sensor colliders. All three are gone. The server owns the race; this owns
 * a PREDICTION of the local ship, so controls answer without waiting a round
 * trip, and the RENDERING of everyone else.
 *
 * There is one rapier world on the client, holding the track and the single
 * predicted chassis. Remote racers are interpolated transforms with no physics
 * at all — their motion is the server's to decide, and simulating it here would
 * only produce a second, disagreeing answer.
 */

import * as THREE from 'three'
import { defineModule } from 'threejs-scene'
import { createHovercraft, createHovercraftState } from '@crash-velocity/physics/vehicle-step'
import { BodyInterpolator } from '@crash-velocity/physics/interpolation'
import { toRaceInput } from '@crash-velocity/race/input'
import { trackBundle } from '@crash-velocity/race'

import { raceHudModule } from '../hud'
import { initialRaceState } from '../state'
import { LocalPrediction } from '../net/prediction'
import { buildRemoteHull } from '../net/remote-hull'
import { buildNameplate } from '../battle/visuals'
import { RaceTransport } from '../race/transport'
import { TRACK_VISUALS } from '../levels/types'
import { activeControls } from '../input'
import { raceTimers, resetRaceTimers, useRaceStore } from '@/hooks/use-race-store'
import { mountBaseScene } from './base'

import type { App, AppModule } from 'threejs-scene'
import type { TrackId } from '@crash-velocity/race'
import type { Nameplate } from '../battle/visuals'
import type { NetRacer } from '../race/transport'
import type { RaceState } from '../state'


export type RaceMountOptions = {
  name?:   string;
  server?: string;
}

/** Grid colours, by finishing position rather than by team. */
const POSITION_TINTS = [ '#22d3ee', '#ff2d6f', '#ffd166', '#8be04e', '#b388ff', '#ff9f45' ]

// Store mirror period. Matches `PUBLISH_PERIOD` in the publish module — the
//  HUD reads `raceTimers` directly and stays exact between commits.
const COMMIT_PERIOD = 1 / 15

type Opponent = {
  root:      THREE.Group;
  nameplate: Nameplate;
}

export async function mountRace (
  canvas: HTMLCanvasElement,
  trackId: TrackId,
  options: RaceMountOptions = {}
): Promise<App<RaceState>> {
  const bundle    = trackBundle(trackId)
  const track     = bundle.spec
  const transport = new RaceTransport()
  const controls  = activeControls()

  let prediction: LocalPrediction | null = null

  const shipRoot  = new THREE.Group()
  const opponents = new Map<string, Opponent>()

  const _pose = new THREE.Vector3()
  const _quat = new THREE.Quaternion()

  /**
   * A provisional grid slot.
   *
   * Only consulted when the input asks for a respawn; the server's answer
   * arrives in the next snapshot and corrects it. Race's real grid is assigned
   * server-side from the join order.
   */
  const provisionalSpawn = {
    position:   [ track.waypoints[0][0], track.waypoints[0][1] + 1.5, track.waypoints[0][2] ] as [number, number, number],
    quaternion: [ 0, 0, 0, 1 ] as [number, number, number, number],
  }

  function ensureOpponent (racer: NetRacer): Opponent {
    let entry = opponents.get(racer.id)
    if (entry)
      return entry

    const root      = buildRemoteHull(POSITION_TINTS[(racer.state.position - 1) % POSITION_TINTS.length])
    const nameplate = buildNameplate()
    root.add(nameplate.sprite)
    shipRoot.add(root)

    entry = { root, nameplate }
    opponents.set(racer.id, entry)
    return entry
  }

  function dropOpponent (id: string): void {
    const entry = opponents.get(id)
    if (!entry)
      return

    entry.nameplate.dispose()
    entry.root.removeFromParent()
    opponents.delete(id)
  }

  /**
   * Draw everyone else, ~100 ms in the past, on SERVER time.
   *
   * Never apply a snapshot straight to a transform: that is what makes a clean
   * 30 Hz stream look like a stuttering one.
   */
  function renderRemotes (): void {
    const renderTime = transport.renderTimeMs()

    for (const racer of transport.remotes()) {
      const entry = ensureOpponent(racer)

      if (!racer.interp.sampleAt(renderTime, _pose, _quat)) {
        // Nothing buffered yet. The origin is a real place on a track, so an
        // unseen ship is hidden rather than parked there.
        entry.root.visible = false
        continue
      }

      entry.root.visible = true
      entry.root.position.copy(_pose)
      entry.root.quaternion.copy(_quat)
      entry.nameplate.set(racer.name, racer.state.position, transport.latest()?.racers.length ?? 1, 'red', false)
    }

    const live = new Set(transport.remotes().map(r => r.id))
    for (const id of [ ...opponents.keys() ])
      if (!live.has(id))
        dropOpponent(id)
  }

  const app = await mountBaseScene<RaceState>({
    canvas,
    levelId:        trackId,
    levelSpec:      track,
    initialState:   initialRaceState(),
    background:     track.background,
    bloom:          track.bloom,
    colliders:      track.colliders,
    colliderOffset: track.colliderOffset,
    buildGeometry:  ctx => TRACK_VISUALS[trackId](ctx, bundle),

    renderOffsetSource: (dt, out) => prediction ? prediction.smoothing(dt, out) : out.set(0, 0, 0),

    gameModuleFactory: (physics, _isVehicleCollider, telemetry, sceneControls, vehicleRef, rig) => {
      // The ONE body in this world besides the track: the predicted local ship.
      const local = createHovercraft(physics.world, provisionalSpawn)

      prediction = new LocalPrediction({
        chassis: local.chassis,
        world:   physics.world,
        state:   createHovercraftState(),
      })

      const localInterpolator = new BodyInterpolator(local.chassis)
      physics.interpolators.push(localInterpolator)

      vehicleRef.current = {
        get body () {
          return local.chassis
        },
        get interpolator () {
          return localInterpolator
        },
        get debug () {
          return prediction?.debug ?? null
        },
        teleportTo (transform, liftY = 1) {
          local.chassis.setTranslation({ x: transform.position[0], y: transform.position[1] + liftY, z: transform.position[2] }, true)
          local.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true)
          local.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true)
          localInterpolator.teleport()
          rig.requestSnap()
        },
      }

      resetRaceTimers()
      transport.connect({
        name:   options.name ?? 'Pilot',
        shipId: 'icaras',
        trackId,
        server: options.server,
      })

      let clientTick   = 0
      let lastSnapshot = 0
      let sinceCommit  = 0
      let lastRespawn  = -1

      // Hoisted out of `update` so the per-frame path stays one straight line:
      //  the store only hears about the link when the link changes its mind.
      let lastLinkError: string | null = null
      const reportLink = () => {
        const linkError = transport.stats().linkError
        if (linkError === lastLinkError)
          return
        lastLinkError = linkError
        useRaceStore.getState().sync({ linkError })
      }

      const raceNetModule: AppModule<RaceState> = defineModule<RaceState>({
        name: 'race-net',
        build () {},
        update (state, frame) {
          clientTick++

          const input = {
            steer:    state.steer,
            strafe:   sceneControls.strafe,
            throttle: state.throttle,
            brake:    state.brake,
            boost:    state.boost,
            reverse:  sceneControls.reverse,
            aimPitch: sceneControls.pitch,
            resetSeq: state.resetSeq,
          }

          // Queue, predict, send — in that order. The frame the server will
          // acknowledge is the same object applied locally, so reconciliation
          // replays exactly what was predicted.
          const frameOut = transport.pushInput(input, clientTick)
          const view     = transport.latest()
          const racing   = view?.status === 'racing'

          prediction?.step(toRaceInput(frameOut), provisionalSpawn, racing)
          transport.flushInput(transport.serverTick())

          // A new snapshot is the only thing that can correct the prediction,
          // so reconciliation runs on arrival rather than every tick.
          const server = transport.localState()
          if (prediction && server && transport.serverTick() !== lastSnapshot) {
            lastSnapshot = transport.serverTick()

            const result = prediction.reconcile(server, transport.unacknowledged(), toRaceInput, provisionalSpawn, racing)
            transport.noteCorrection(result.correctionM)

            // Any correction at all cuts the interpolator, not just a hard
            // one. The body has been moved to the server's truth, so blending
            // across that move would render the old pose while the offset is
            // ALSO displacing by it — the error applied twice, in the same
            // direction. The offset alone carries the visual now.
            if (result.correctionM > 0)
              localInterpolator.teleport()

            if (result.snapped)
              rig.requestSnap()
          }

          const velocity       = local.chassis.linvel()
          telemetry.speed      = Math.hypot(velocity.x, velocity.z)
          telemetry.boostMeter = prediction?.boost ?? 1
          telemetry.boosting   = sceneControls.boost
          telemetry.grounded   = prediction?.grounded ?? false
          telemetry.airbrake   = prediction?.airbrake ?? 0

          // Above the early return, deliberately: a link that never came up is
          // exactly the case where there is no view and no server state, so
          // reporting it below this line would report it never.
          reportLink()

          if (!view || !server)
            return

          // Clocks advance from the server's authoritative values rather than a
          // local accumulator, so a lap time on the HUD is the one that will be
          // recorded — not one that has drifted by however long the tab was hidden.
          raceTimers.elapsed    = server.elapsed
          raceTimers.lapElapsed = server.lapElapsed
          raceTimers.countdown  = view.countdown

          // A respawn is signalled by the counter, never by an event: a dropped
          // event would leave the camera blending across a relocation.
          if (lastRespawn >= 0 && server.respawnIndex !== lastRespawn) {
            localInterpolator.teleport()
            rig.requestSnap()
          }
          lastRespawn = server.respawnIndex

          sinceCommit += frame.delta
          if (sinceCommit < COMMIT_PERIOD)
            return
          sinceCommit = 0

          useRaceStore.getState().sync({
            status:          view.status,
            countdown:       view.countdown,
            laps:            view.laps,
            trackId:         view.trackId,
            currentLap:      server.lap,
            nextCheckpoint:  server.nextCheckpoint,
            checkpointCount: track.waypoints.length,
            loop:            track.loop,
            position:        server.position,
            gridSize:        view.racers.length,
            elapsed:         server.elapsed,
            lapElapsed:      server.lapElapsed,
            bestLap:         server.bestLap,
            finished:        server.finished,
            standings:       [ ...view.racers ]
              .sort((a, b) => a.position - b.position)
              .map(r => ({ id: r.id, name: r.name, position: r.position, lap: r.lap, bestLap: r.bestLap, finished: r.finished, isBot: r.isBot })),
          })
        },
      })

      return { module: raceNetModule }
    },

    hudModuleFactory: (_shipRoot, telemetry, hudRef, hudControls) =>
      raceHudModule(canvas, track, telemetry, hudControls, hudRef),

    extraModules: [
      defineModule<RaceState>({
        name:  'race-visuals',
        build: ctx => ctx.scene.add(shipRoot),
      }),
    ],

    onFrame: () => {
      transport.drainEvents()
      renderRemotes()
    },

    onDispose: () => {
      for (const id of [ ...opponents.keys() ])
        dropOpponent(id)
      transport.close()
      useRaceStore.getState().reset()
    },
  })

  void controls
  return app
}
