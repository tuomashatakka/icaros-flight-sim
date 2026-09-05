import * as THREE from 'three'
import type { App, AppModule } from 'threejs-scene'
import { defineModule } from 'threejs-scene'
import { apexArena, BATTLE_TEAMS, TEAM_COLORS } from 'Ψarena'
import type { Scenery } from 'Σbattle/scenery'
import { reducedMotion } from 'Σlifecycle'
import type { BattleTeam } from 'Ψarena'
import { AIM_MAX, DEFAULT_BATTLE_CONFIG } from 'Ψsim'
import type { BattleEvent } from 'Ψtypes'
import { DEFAULT_LOADOUT, WEAPONS } from 'Ψweapons'
import type { Loadout } from 'Ψweapons'

// One definition of where a shot starts and which way it goes, shared with the
//  sim — the discipline `hitscan.ts` already follows. The sight draws the same
//  vector the server resolves against.
import { aimFrom, castArenaRay, muzzleFrom } from 'Ψaim'
import { resolveBeamHits } from 'Ψhitscan'

import type { HitCandidate } from 'Ψhitscan'
import type RAPIER from '@dimforge/rapier3d-deterministic-compat'
import { buildObjective, buildZoneVisual } from 'Σbattle/visuals'
import type { ObjectiveVisual, ZoneVisual } from 'Σbattle/visuals'
import { BattleTransport } from 'Σbattle/transport'
import type { BattleFrame, ViewPlayer } from 'Σbattle/transport'
import { LocalPrediction } from 'Σnet/prediction'
import { publishTelemetry } from 'Σnet/telemetry-publish'
import { createHovercraft, createHovercraftState } from 'Φvehicle-step'
import { BodyInterpolator } from 'Φinterpolation'
import { battleStore } from 'Ƨ'
import type { ShipId } from 'Ȼship/registry'
import { vehicleConfig } from 'Φconfig'
import { mountBaseScene } from 'Σscenes/base'
import { activeControls } from 'Σinput'
import { toBattleInput } from 'Ψinput'
import { createBattlePost } from 'Σbattle/post'
import { arenaEnvironment, buildArenaVisual } from 'Σbattle/arena-visuals'
import { ProjectileField } from 'Σbattle/projectiles'
import type { CameraRig } from 'Σcamera/rig'
import { battleHudModule } from 'Σhud/index'
import type { HudSight } from 'Σhud/index'
import type { ShipVisualHandle } from 'Σmodules/ship-visual'
import { createBattlePools } from 'Σbattle/pools'
import type { BattlePools } from 'Σbattle/pools'
import { createOpponents } from 'Σbattle/opponents'
import type { Opponents } from 'Σbattle/opponents'
import { createBattlePublisher } from 'Σmodules/publish-battle'


export type BattleState = {
  steer:    number;
  throttle: boolean;
  brake:    boolean;
  boost:    boolean;
  resetSeq: number;
}

export const initialBattleState = (): BattleState => ({
  steer:    0,
  throttle: false,
  brake:    false,
  boost:    false,
  resetSeq: 0,
})

export type BattleMountOptions = {
  name?:    string;
  shipId?:  ShipId;
  loadout?: Partial<Loadout>;

  /** Room to join. The server picks its default match when omitted. */
  match?: string;

  /** `?sv=` dev override: a full ws:// URL or a bare port. */
  server?: string;

  /** The route's `touch` parameter, read by the page with `useSearchParams`. */
  forcedTouch?: string | null;
}

/**
 * The battle scene composition root extending `mountBaseScene`.
 *
 * Battle is network-only. The rules, the physics and every outcome live on the
 * authoritative server (`packages/server`); this scene owns exactly two things
 * the server cannot: a PREDICTION of the local ship, so controls answer without
 * waiting a round trip, and the rendering of everyone else, interpolated ~100 ms
 * in the past on the server's own clock.
 *
 * There is one rapier world here now — the base scene's, holding the arena and
 * the single predicted chassis. The old local `BattleSim` built a second world
 * with a second copy of the arena colliders and stepped it from a different
 * module in the same tick.
 *
 * Rendering never puts remote positions into React. The canvas HUD reads the
 * slim `battleStore` snapshot, which `publish-battle.ts` commits on the same
 * cadence this scene always ran it at.
 */
export async function mountBattle (
  canvas: HTMLCanvasElement,
  options: BattleMountOptions = {}
): Promise<App<BattleState>> {
  const arena            = apexArena()
  const name             = options.name ?? 'Pilot'
  const shipId           = options.shipId ?? 'icaras'
  const loadout: Loadout = { ...DEFAULT_LOADOUT, ...options.loadout }

  const transport = new BattleTransport()
  let renderFrame: BattleFrame | null = null
  const projectilePoseOf = (id: string) => renderFrame?.playersById.get(id) ?? null

  // Every `battleActions.*` call the scene makes lives behind this — see
  // `publish-battle.ts`. Constructing it fires the match reset, exactly where
  // that call used to sit.
  const publisher = createBattlePublisher({ transport, arena, loadout })

  // Prediction needs somewhere to stand before the first snapshot lands. Red
  // lane 0 is a guess; the first reconciliation moves the ship to wherever the
  // server actually seated it, and that correction is over the hard-snap
  // threshold so it does not try to smooth across the arena.
  const provisionalSpawn = arena.spawns.red[0]
  let prediction: LocalPrediction | null = null

  // Assigned inside `gameModuleFactory`; the sight and the frame loop read
  // them long afterwards.
  let world: RAPIER.World | null  = null
  let sightRay: RAPIER.Ray | null = null
  let opponents: Opponents | null = null
  let pools: BattlePools | null   = null
  type ShipVisualRefType = { current: ShipVisualHandle | null }

  const shipVisualRef: ShipVisualRefType = { current: null }

  /**
   * Where the guns point and what the shot hits, for the HUD reticle.
   *
   * Built from `battle/aim.ts` — the same muzzle and aim functions the
   * authoritative sim fires along — so the pipper cannot drift from the shot.
   * The impact is the nearer of the arena ray and the nearest enemy hull, which
   * is exactly what `fireBeam` computes as its reach and then throws away.
   *
   * Everything here is a PREDICTION: the local chassis is predicted and the
   * remote hulls are interpolated ~100 ms in the past, so this says where a
   * shot fired now would land, not where the server will decide it did.
   */
  const sight: HudSight = {
    origin:     new THREE.Vector3(),
    direction:  new THREE.Vector3(),
    impact:     null,
    range:      Number.POSITIVE_INFINITY,
    onTarget:   false,
    hardpoints: [],
  }
  const sightImpact                      = new THREE.Vector3()
  const sightRotation                    = new THREE.Quaternion()
  const sightHardpoints: THREE.Vector3[] = []
  const hitCandidates: HitCandidate[]    = []

  function readSight (): HudSight | null {
    const chassis = prediction?.rig.chassis
    if (!chassis || !world || !sightRay)
      return null

    const q = chassis.rotation()
    sightRotation.set(q.x, q.y, q.z, q.w)
    muzzleFrom(sight.origin, chassis.translation(), sightRotation)
    aimFrom(sight.direction, sightRotation, prediction!.aimNormalised * AIM_MAX)

    const store  = battleStore.get()
    const weapon = store.primary ? WEAPONS[store.primary.id] : WEAPONS[DEFAULT_LOADOUT.primary]
    const reach  = weapon.range

    const arenaToi = castArenaRay(world, sightRay, sight.origin, sight.direction, reach)
    let distance = Math.min(arenaToi, reach)
    let onTarget = false

    const team = store.myTeam
    if (team) {
      hitCandidates.length = 0
      for (const remote of renderFrame?.remotes ?? transport.remotes()) {
        // The RENDERED pose, not the snapshot's: remote ships are drawn ~100 ms
        // in the past, and a reticle that marks where a ship is not is worse
        // than no reticle. The server resolves the actual shot by rewinding to
        // this same view, so agreeing with the screen is the correct choice.
        const drawn = opponents?.hullPosition(remote.id)
        if (drawn && remote.team !== team)
          hitCandidates.push({ id: remote.id, team: remote.team, position: drawn })
      }

      const hit = resolveBeamHits({
        origin:    sight.origin,
        direction: sight.direction,
        reach:     distance,
        radius:    DEFAULT_BATTLE_CONFIG.hullRadius + (weapon.beamWidth ?? 0.2),
        team,
      }, hitCandidates)[0]

      if (hit) {
        distance = hit.distance
        onTarget = true
      }
    }

    sight.range    = distance
    sight.onTarget = onTarget
    sight.impact   = Number.isFinite(distance)
      ? sightImpact.copy(sight.direction).multiplyScalar(distance)
        .add(sight.origin)
      : null
    sight.hardpoints = shipVisualRef.current?.muzzleWorld(sightHardpoints) ?? sightHardpoints

    return sight
  }

  const post = createBattlePost()

  // Built inside `buildGeometry`, ticked from `onFrame`: the sky panels and the
  // debris drift need a clock, and nothing else in the arena does.
  let scenery: Scenery | null = null

  /**
   * Missiles in flight, integrated locally from fire events.
   *
   * Lives beside the transport rather than inside it because a projectile is a
   * gameplay object with a lifetime, not a packet — and because the render
   * pass, not the network pass, is what has a `dt` to step it with.
   */
  const projectiles = new ProjectileField()

  // Triggers themselves live on the shared `Controls` surface (`input.ts`), so
  // keyboard, mouse and the on-screen touch buttons all drive one set of flags.
  // Only the mouse binding is scene-local, because left-drag already steers and
  // the other two buttons are meaningless outside a match.
  // `activeControls()` rather than a captured reference: these listeners are
  // installed before `mountBaseScene` has built the control surface, and they
  // only ever run long after it has.
  const setTrigger = (e: PointerEvent, down: boolean) => {
    const c = activeControls()
    if (!c)
      return
    if (e.button === 2)
      c.fireSecondary = down
    else if (e.button === 1)
      c.fire = down
  }
  const onPointerDown = (e: PointerEvent) => setTrigger(e, true)
  const onPointerUp   = (e: PointerEvent) => setTrigger(e, false)
  const onContextMenu = (e: Event) => e.preventDefault()

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('contextmenu', onContextMenu)

  // --- persistent visuals ---------------------------------------------------

  const zoneVisuals: ZoneVisual[] = arena.controlPoints.map(cp => {
    const visual = buildZoneVisual(cp.radius)
    visual.group.position.set(cp.position[0], cp.position[1], cp.position[2])
    return visual
  })

  const objectives: Partial<Record<BattleTeam, ObjectiveVisual>> = {}
  for (const team of BATTLE_TEAMS)
    objectives[team] = buildObjective(team)

  /** The ship a snapshot id refers to, whoever owns it. */
  function playerIn (id: string): ViewPlayer | undefined {
    return (renderFrame ?? transport.frame())?.playersById.get(id)
  }

  /**
   * Put a burst on a player, by id.
   *
   * Events carry ids rather than coordinates, and the snapshot is
   * authoritative anyway — a position baked into the event would already be a
   * tick stale by the time the render phase drew it.
   */
  function burstAt (id: string, colour: THREE.ColorRepresentation, scale: number) {
    const player = playerIn(id)
    if (!player)
      return

    pools?.blast.spawn({ x: player.x, y: player.y + 0.6, z: player.z }, colour, scale)
  }

  /**
   * Turn a sim event into camera shake and a frame flash.
   *
   * Keyed off the local player on purpose: a kill across the map should not
   * punch your camera. `rig.shake` decays on its own from a seeded jitter, so
   * this only ever kicks it and never has to wind it back down.
   */
  function reactTo (e: BattleEvent, rig: CameraRig) {
    switch (e.type) {
      case 'fire':
        // The server's confirmation. It REPLACES whatever the client spawned
        // optimistically for this shot rather than adding to it — see
        // `ProjectileField.confirm`.
        if (e.spawn)
          projectiles.confirm(e.spawn)

        if (e.id === transport.localId())
          rig.shake(WEAPONS[e.weapon].needsLock ? 0.5 : 0.22)
        break
      case 'detonate':
        projectiles.detonate(e.id)
        break
      case 'hit':
        burstAt(e.target, TEAM_COLORS[playerIn(e.hitBy)?.team as BattleTeam ?? 'red'], 1.1)
        if (e.target === transport.localId()) {
          rig.shake(0.7)
          post.pulse(0.55, '#ff5470')
        }
        else if (e.hitBy === transport.localId())
          post.pulse(0.16, '#9fe8ff')
        break
      case 'kill':
        burstAt(e.target, '#ffd28a', 4.2)
        if (e.target === transport.localId()) {
          rig.shake(1.6)
          post.pulse(1.1, '#ff2d6f')
        }
        else if (e.hitBy === transport.localId())
          post.pulse(0.4, '#b7f34a')
        break
      case 'lock':
        if (e.id === transport.localId())
          post.pulse(0.22, '#22d3ee')
        break
      case 'flagScored':
        post.pulse(0.5, TEAM_COLORS[e.team])
        break
      default:
        break
    }
  }

  /** Objectives and control points, both straight off the snapshot. */
  function renderWorld (snapshot: BattleFrame, elapsed: number): void {
    for (const team of BATTLE_TEAMS) {
      const visual = objectives[team]
      const state  = snapshot.flagsByTeam.get(team)
      if (!visual || !state)
        continue
      visual.group.position.set(state.x, state.y, state.z)
      visual.update(elapsed, state.state === 'carried')
    }

    for (let i = 0; i < zoneVisuals.length; i++) {
      const visual = zoneVisuals[i]
      const z      = snapshot.zonesById.get(arena.controlPoints[i].id)
      if (z)
        visual.update(z.owner, z.capturing, z.progress, z.contested, elapsed)
    }
  }

  const app = await mountBaseScene<BattleState>({
    canvas,
    initialState:   initialBattleState(),
    environment:    arenaEnvironment(arena),
    bloom:          arena.bloom,
    colliders:      arena.colliders,
    colliderOffset: arena.colliderOffset,
    shipVisualRef,
    // The trim is predicted locally and corrected against the server, because
    // a reticle that waits half a round trip to move feels broken; the hull and
    // camera mirror whatever elevation it settled on.
    aimPitchSource: () => prediction?.aimNormalised ?? 0,
    // The deck's diagonal is ~850 units; the race rig's 400 far plane would
    // clip the far wall clean off.
    cameraFar:      1600,
    buildGeometry:  ctx => {
      scenery = buildArenaVisual(ctx, arena)
    },
    post:      post.options,
    onQuality: level => post.setQuality(level),

    gameModuleFactory: (physics, telemetry, controls, vehicleRef, rig) => {
      // The sight casts against the same world the sim does, through one reused
      // ray — it runs every frame the HUD redraws.
      world    = physics.world
      sightRay = new physics.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })

      // Every remote is an interpolated transform with no physics at all,
      // because their motion is the server's to decide and simulating it here
      // would only produce a second, disagreeing answer.
      opponents = createOpponents({ transport, camera: rig.camera })

      // The ONE body in this world besides the arena: the predicted local ship.
      const local = createHovercraft(physics.world, {
        position:   provisionalSpawn.position,
        quaternion: provisionalSpawn.quaternion,
      })

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

      transport.connect({ name, shipId, loadout, match: options.match, server: options.server })

      let clientTick   = 0
      let lastSnapshot = 0

      const battleGameModule: AppModule<BattleState> = defineModule<BattleState>({
        name: 'battle-net',
        build () {},
        update (state) {
          clientTick++

          const input = {
            steer:         state.steer,
            throttle:      state.throttle,
            brake:         state.brake,
            boost:         state.boost,
            fire:          controls.fire,
            fireSecondary: controls.fireSecondary,
            reverse:       controls.reverse,
            strafe:        controls.strafe,
            aimPitch:      controls.pitch,
            resetSeq:      state.resetSeq,
          }

          // Queue, predict, send — in that order. The frame the server will
          // eventually acknowledge is the same object applied locally, so
          // reconciliation replays exactly what was predicted.
          const frame = transport.pushInput(input, clientTick)
          prediction?.step(toBattleInput(frame), provisionalSpawn, true)
          transport.flushInput(transport.serverTick())

          // A new snapshot is the only thing that can correct the prediction,
          // so reconciliation runs on arrival rather than every tick.
          const server = transport.localState()
          if (prediction && server && transport.serverTick() !== lastSnapshot) {
            lastSnapshot = transport.serverTick()

            const result = prediction.reconcile(server, transport.unacknowledged(), toBattleInput, provisionalSpawn, true)
            transport.noteCorrection(result.correctionM)

            if (result.snapped) {
              localInterpolator.teleport()
              rig.requestSnap()
            }
          }

          const velocity = local.chassis.linvel()
          telemetry.velocity.set(velocity.x, velocity.y, velocity.z)
          publishTelemetry(telemetry, local.chassis, prediction, controls.boost)

          // Every `battleActions.*` write the scene makes happens inside this
          // one call, on the cadence the scene always ran it at — see
          // `publish-battle.ts`. What comes back is for US: camera shake and
          // the post pulse, which are not store writes and stay here.
          const snapshot = transport.frame()
          const events   = publisher.tick(prediction?.aimNormalised ?? 0, snapshot, server)
          for (const event of events)
            reactTo(event, rig)
        },
      })

      return { module: battleGameModule }
    },

    hudModuleFactory: (_shipRoot, telemetry, hudRef, controls) =>
      battleHudModule(canvas, telemetry, controls, hudRef, readSight, options.forcedTouch),

    extraModules: [
      defineModule<BattleState>({
        name:  'battle-visuals',
        build: ctx => {
          for (const objective of Object.values(objectives))
            if (objective)
              ctx.scene.add(objective.group)
          for (const zone of zoneVisuals)
            ctx.scene.add(zone.group)
          if (opponents)
            ctx.scene.add(opponents.shipRoot, opponents.overlays)
          pools = createBattlePools(ctx.scene)
        },
      }),
    ],

    onFrame: frame => {
      const elapsed = frame.elapsed

      // Motion blur rides ground speed rather than the boost flag, so coasting
      // fast still streaks and tapping boost from a standstill does not.
      const lv = prediction?.rig.chassis.linvel()
      post.setSpeed(lv ? Math.hypot(lv.x, lv.z) / vehicleConfig.maxSpeed : 0)
      if (!reducedMotion())
        scenery?.update(elapsed)
      pools?.blast.update(frame.delta)

      renderFrame = transport.frame()
      if (!renderFrame)
        return

      opponents?.sync(renderFrame)
      opponents?.render(elapsed)

      // Stepped on the RENDER delta, not the sim step: these are visuals whose
      // authoritative outcome the server already decided, and a missile that
      // stutters between physics ticks reads as a dropped frame.
      projectiles.step(frame.delta, projectilePoseOf)

      pools?.step(renderFrame, projectiles)
      renderWorld(renderFrame, elapsed)
    },

    onDispose: () => {
      projectiles.clear()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('contextmenu', onContextMenu)

      opponents?.dispose()
      for (const objective of Object.values(objectives))
        objective?.dispose()
      for (const zone of zoneVisuals)
        zone.dispose()
      pools?.dispose()
      transport.close()
    },
  })

  // Dev-only handle on the match.
  //
  // The generic `window.__dev` harness speaks vehicle-and-track; nothing in it
  // can read a lock meter, confirm a beam was drawn, or move an enemy. Named
  // with the `__dev` prefix on purpose so the post-build leak grep
  // (`grep -r "__dev" .next/static`) catches this too if the guard ever breaks.
  //
  // `place` and `face` used to reach into a local sim. There is no local sim
  // any more, so they are requests to the authority — which ignores them unless
  // it was started with `DEV_COMMANDS=1`.
  if (process.env.NODE_ENV !== 'production')
    (window as unknown as Record<string, unknown>).__devBattle = {
      probe: () => {
        const snapshot = transport.latest()
        const server   = transport.localState()
        return {
          connected: transport.localId() !== null,
          net:       transport.stats(),
          status:    snapshot?.status ?? 'offline',
          scores:    snapshot?.scores ?? { red: 0, blue: 0 },
          lock:      server ? { phase: server.lockPhase, targetId: server.lockTarget, progress: server.lockMeter } : null,
          beams:     snapshot?.beams.length ?? 0,
          missiles:  projectiles.count,
          players:   (snapshot?.players ?? []).map(p => ({
            id:   p.id,
            team: p.team,
            hp:   p.health,
            x:    Math.round(p.x),
            y:    Math.round(p.y),
            z:    Math.round(p.z),
          })),
          zones: (snapshot?.zones ?? []).map(z => ({
            id:       z.id,
            owner:    z.owner,
            progress: Math.round(z.progress * 100) / 100,
          })),
        }
      },

      // `place` and `face` are gone with the hand-rolled protocol. They existed
      //  to poke a running match from a script; `@colyseus/playground` joins a
      //  real room and does it without a bespoke message family in the wire.
    }

  return app
}
