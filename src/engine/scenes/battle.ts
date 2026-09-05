import * as THREE from 'three'
import type { App, AppModule } from 'threejs-scene'
import { defineModule } from 'threejs-scene'
import { apexArena, BATTLE_TEAMS, TEAM_COLORS } from '@crash-velocity/battle/arena'
import type { Scenery } from '../battle/scenery'
import type { BattleTeam } from '@crash-velocity/battle/arena'
import { AIM_MAX, DEFAULT_BATTLE_CONFIG } from '@crash-velocity/battle/sim'
import type { BattleEvent } from '@crash-velocity/battle/types'
import { DEFAULT_LOADOUT, WEAPONS } from '@crash-velocity/battle/weapons'
import type { Loadout, WeaponId } from '@crash-velocity/battle/weapons'

// One definition of where a shot starts and which way it goes, shared with the
//  sim — the discipline `hitscan.ts` already follows. The sight draws the same
//  vector the server resolves against.
import { aimFrom, castArenaRay, muzzleFrom } from '@crash-velocity/battle/aim'
import { resolveBeamHits } from '@crash-velocity/battle/hitscan'

import type { HitCandidate } from '@crash-velocity/battle/hitscan'
import type RAPIER from '@dimforge/rapier3d-deterministic-compat'
import {
  buildBeamPool,
  buildCaretMarker,
  buildMissilePool,
  buildNameplate,
  buildObjective,
  buildZoneVisual,
  buildExplosionPool
} from '../battle/visuals'
import { updateZoneEffects } from '../battle/visuals'
import type { CaretMarker, Nameplate, ObjectiveVisual, ZoneVisual } from '../battle/visuals'
import { BattleTransport } from '../battle/transport'
import type { NetRemote } from '../battle/transport'
import type { ViewPlayer } from '../battle/transport'
import { LocalPrediction } from '../net/prediction'
import { createHovercraft, createHovercraftState } from '@crash-velocity/physics/vehicle-step'
import { BodyInterpolator } from '@crash-velocity/physics/interpolation'
import { useBattleStore } from '@/hooks/use-battle-store'
import { IDLE_LOCK } from '@/hooks/use-battle-store'
import type { ShipId } from '@/lib/ship/registry'
import { vehicleConfig } from '@/lib/utils'
import { mountBaseScene } from './base'
import { activeControls } from '../input'
import { toBattleInput } from '@crash-velocity/battle/input'
import { buildRemoteHull } from '../net/remote-hull'
import { createBattlePost } from '../battle/post'
import { arenaEnvironment, buildArenaVisual } from '../battle/arena-visuals'
import { ProjectileField } from '../battle/projectiles'
import type { CameraRig } from '../camera/rig'
import { battleHudModule } from '../hud'
import type { HudSight } from '../hud'
import type { ShipVisualHandle } from '../modules/ship-visual'
import { BATTLE_EFFECT_BUDGETS, BattleRenderView, withinBudget } from '../battle/render-view'


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

/** Beams and missiles both cap out well under these; the pools never grow. */
/**
 * Opponent hull.
 *
 * Deliberately procedural rather than a loaded ship: a battle can hold a dozen
 * hulls, and the FBX path clones geometry AND textures per instance. This is
 * one draw call's worth of boxes that still reads as a ship at 100 m.
 */

type Opponent = {
  root:      THREE.Group;
  nameplate: Nameplate;
  caret:     CaretMarker;
}

const _pose = new THREE.Vector3()
const _quat = new THREE.Quaternion()

export type BattleMountOptions = {
  name?:    string;
  shipId?:  ShipId;
  loadout?: Partial<Loadout>;

  /** Room to join. The server picks its default match when omitted. */
  match?: string;

  /** `?sv=` dev override: a full ws:// URL or a bare port. */
  server?: string;
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
 * slim `useBattleStore` snapshot, which the transport commits on a timer.
 */
export async function mountBattle (
  canvas: HTMLCanvasElement,
  options: BattleMountOptions = {}
): Promise<App<BattleState>> {
  const arena            = apexArena()
  const name             = options.name ?? 'Pilot'
  const shipId           = options.shipId ?? 'icaras'
  const loadout: Loadout = { ...DEFAULT_LOADOUT, ...options.loadout }
  const quality          = typeof window === 'undefined' || new URLSearchParams(window.location.search).get('post') !== 'low'
    ? 'high'
    : 'low'
  const effectBudget = BATTLE_EFFECT_BUDGETS[quality]
  const renderView   = new BattleRenderView()

  const transport = new BattleTransport()

  useBattleStore.getState().resetSession()

  // Prediction needs somewhere to stand before the first snapshot lands. Red
  // lane 0 is a guess; the first reconciliation moves the ship to wherever the
  // server actually seated it, and that correction is over the hard-snap
  // threshold so it does not try to smooth across the arena.
  const provisionalSpawn = arena.spawns.red[0]
  let prediction: LocalPrediction | null = null

  // Assigned inside `gameModuleFactory`; the sight reads them long afterwards.
  let world: RAPIER.World | null  = null
  let sightRay: RAPIER.Ray | null = null
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
  let sightKey = ''

  function readSight (): HudSight | null {
    const chassis = prediction?.rig.chassis
    if (!chassis || !world || !sightRay)
      return null

    const q            = chassis.rotation()
    const p            = chassis.translation()
    const remotes      = transport.remotes()
    const store        = useBattleStore.getState()
    const nextSightKey = [ p.x, p.y, p.z, q.x, q.y, q.z, q.w, prediction?.aimNormalised,
      store.primary?.id,
      ...remotes.flatMap(remote => {
        const drawn = opponents.get(remote.id)?.root.position
        return [ remote.id, drawn?.x, drawn?.y, drawn?.z, remote.state.health ]
      }) ].join('|')
    // HUD rendering can ask more than once per display frame. Rapier traversal
    // is pointless until the aim, hull or an eligible target actually moved.
    if (nextSightKey === sightKey)
      return sight
    sightKey = nextSightKey

    sightRotation.set(q.x, q.y, q.z, q.w)
    muzzleFrom(sight.origin, p, sightRotation)
    aimFrom(sight.direction, sightRotation, prediction!.aimNormalised * AIM_MAX)

    const weapon = store.primary ? WEAPONS[store.primary.id] : WEAPONS[DEFAULT_LOADOUT.primary]
    const reach  = weapon.range

    const arenaToi = castArenaRay(world, sightRay, sight.origin, sight.direction, reach)
    let distance = Math.min(arenaToi, reach)
    let onTarget = false

    const team = store.myTeam
    if (team) {
      hitCandidates.length = 0
      for (const remote of remotes) {
        // The RENDERED pose, not the snapshot's: remote ships are drawn ~100 ms
        // in the past, and a reticle that marks where a ship is not is worse
        // than no reticle. The server resolves the actual shot by rewinding to
        // this same view, so agreeing with the screen is the correct choice.
        const drawn = opponents.get(remote.id)?.root.position
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

  const beamPool    = buildBeamPool(effectBudget.beams)
  const missilePool = buildMissilePool(effectBudget.missiles)
  const blastPool   = buildExplosionPool(effectBudget.explosions)

  const opponents = new Map<string, Opponent>()
  const shipRoot  = new THREE.Group()
  const overlays  = new THREE.Group()

  // The local ship needs its own caret target too — for the ONE enemy the local
  // player is tracking, drawn around that enemy, not around us.
  const tickCount = 0

  /**
   * Zone views for the HUD.
   *
   * The snapshot carries zone ids and state but not display names — those live
   * in the arena, which the client has its own copy of. Joining them here is
   * why `useBattleStore.setChrome` gets real names instead of the id fallback
   * the transport writes when it commits on its own.
   */
  const zoneViews = (snapshot: ReturnType<BattleTransport['latest']>) =>
    (snapshot?.zones ?? []).map(z => {
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

  const nameOf = () => new Map((transport.latest()?.players ?? []).map(p => [ p.id, p.name ]))

  function ensureOpponent (remote: NetRemote): Opponent {
    let entry = opponents.get(remote.id)
    if (entry)
      return entry

    const root      = buildRemoteHull(TEAM_COLORS[remote.team])
    const nameplate = buildNameplate()
    const caret     = buildCaretMarker()
    root.add(nameplate.sprite)
    shipRoot.add(root)
    overlays.add(caret.group)

    entry = { root, nameplate, caret }
    opponents.set(remote.id, entry)
    return entry
  }

  function dropOpponent (id: string): void {
    const entry = opponents.get(id)
    if (!entry)
      return
    entry.nameplate.dispose()
    entry.caret.dispose()
    entry.root.removeFromParent()
    entry.caret.group.removeFromParent()
    opponents.delete(id)
  }

  /** The ship a snapshot id refers to, whoever owns it. */
  function playerIn (id: string): ViewPlayer | undefined {
    return transport.latest()?.players.find(p => p.id === id)
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

    const position   = { x: player.x, y: player.y + 0.6, z: player.z }
    const importance = renderView.sample({ position, radius: scale, kind: 'explosion' }).importance
    blastPool.spawn(position, colour, scale, importance)
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

  /**
   * Push one snapshot into the HUD store.
   *
   * Every field here is the SERVER'S. Lock in particular: the server owns the
   * cone test, and a client that decided its own would disagree with the
   * authority about who it was shooting.
   */
  function publishHud (server: ViewPlayer, snapshot: NonNullable<ReturnType<BattleTransport['latest']>>): void {
    const store  = useBattleStore.getState()
    const target = server.lockTarget ? playerIn(server.lockTarget) : undefined

    if (target)
      store.setLockOn({
        phase:    server.lockPhase,
        targetId: target.id,
        name:     target.name,
        distance: Math.hypot(target.x - server.x, target.y - server.y, target.z - server.z),
        team:     target.team,
        progress: server.lockMeter,
      })
    else
      store.setLockOn(IDLE_LOCK)

    store.setPilot({
      health:    server.health,
      maxHealth: server.maxHealth,
      boost:     server.boost,
      kills:     server.kills,
      deaths:    server.deaths,
      carrying:  snapshot.flags.find(f => f.carrierId === server.id)?.team ?? null,
    })

    const primarySpec   = WEAPONS[loadout.primary]
    const secondarySpec = WEAPONS[loadout.secondary]
    store.setWeapons(
      { id: primarySpec.id, cooldown: server.primaryCd, needsLock: primarySpec.needsLock },
      { id: secondarySpec.id, cooldown: server.secondaryCd, needsLock: secondarySpec.needsLock }
    )

    store.setChrome({
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

  /**
   * Draw every remote ship where the server says it was ~100 ms ago.
   *
   * Rendering the newest pose straight onto a transform is what made a clean
   * 30 Hz stream look like a stuttering one — a remote is only ever drawn from
   * the interpolator, never from a packet.
   */
  function renderRemotes (elapsed: number): void {
    const snapshot   = transport.latest()
    const server     = transport.localState()
    const renderTime = transport.renderTimeMs()

    for (const remote of transport.remotes()) {
      const entry = ensureOpponent(remote)

      if (!remote.interp.sampleAt(renderTime, _pose, _quat)) {
        // Nothing buffered yet. (0, 0, 0) is a real place on this map, so an
        // unseen ship is hidden rather than parked at the origin.
        entry.root.visible = false
        entry.caret.setVisible(false)
        continue
      }

      entry.root.visible = true
      entry.root.position.copy(_pose)
      entry.root.quaternion.copy(_quat)

      const tracked                  = Boolean(server) && server?.lockTarget === remote.id && remote.team !== transport.localTeam()
      const view                     = renderView.sample({ position: entry.root.position, radius: 3, kind: 'remote', target: tracked })
      entry.root.visible             = view.tier !== 'hidden'
      entry.nameplate.sprite.visible = view.tier === 'full' || view.tier === 'reduced'
      if (view.tier === 'hidden') {
        entry.caret.setVisible(false)
        continue
      }

      const carrying = snapshot?.flags.some(f => f.carrierId === remote.id) ?? false
      if (view.update && view.tier !== 'transform')
        entry.nameplate.set(remote.name, remote.state.health, remote.state.maxHealth, remote.team, carrying)

      // The caret only ever appears on the ONE ship the local player's lock is
      // working on — a bracket on every enemy is wallpaper, not a target.
      entry.caret.setVisible(tracked && server?.lockPhase !== 'idle')
      if (tracked && server) {
        entry.caret.group.position.set(_pose.x, _pose.y + 1.4, _pose.z)
        entry.caret.group.updateMatrixWorld()
        entry.caret.update(app.ctx.camera, server.lockMeter, server.lockPhase === 'locked', true, elapsed)
      }
    }

    const live = new Set(transport.remotes().map(r => r.id))
    for (const id of [ ...opponents.keys() ])
      if (!live.has(id))
        dropOpponent(id)
  }

  /** Objectives, weapons and control points, all straight off the snapshot. */
  function renderWorld (snapshot: NonNullable<ReturnType<BattleTransport['latest']>>, elapsed: number): void {
    updateZoneEffects(elapsed)
    for (const team of BATTLE_TEAMS) {
      const visual = objectives[team]
      const state  = snapshot.flags.find(f => f.team === team)
      if (!visual || !state)
        continue
      visual.group.position.set(state.x, state.y, state.z)

      const view           = renderView.sample({ position: visual.group.position, radius: 3, kind: 'objective' })
      visual.group.visible = view.tier !== 'hidden'
      if (view.update)
        visual.update(elapsed, state.state === 'carried')
    }

    // Beams are sub-100 ms flashes, drawn from the newest snapshot rather than
    // interpolated: one smoothed into the past would arrive after the impact it
    // belongs to.
    const beams = withinBudget(snapshot.beams.filter(b => renderView.sample({
      position: { x: b.to[0], y: b.to[1], z: b.to[2] }, radius: 1, kind: 'projectile',
    }).tier !== 'hidden'), effectBudget.beams, b => renderView.sample({
      position: { x: b.to[0], y: b.to[1], z: b.to[2] }, radius: 1, kind: 'projectile',
    }).importance)
    beams.forEach((b, i) => {
      const spec = WEAPONS[b.weapon]
      // Fade over the beam's remaining life so a hit reads as a flash, not a
      // rod that blinks out.
      beamPool.show(i, { x: b.from[0], y: b.from[1], z: b.from[2] }, { x: b.to[0], y: b.to[1], z: b.to[2] },
                    b.weapon, Math.max(0, Math.min(1, b.life / (spec.beamLife ?? 0.1))))
    })
    beamPool.hideFrom(beams.length)

    // Missiles are NOT in the snapshot any more — they are spawned from a fire
    // event and integrated locally, so this draws whatever the field stepped
    // this frame rather than dead-reckoning from a packet that is already old.
    const live = withinBudget(projectiles.live.filter(m => renderView.sample({
      position: { x: m.position[0], y: m.position[1], z: m.position[2] }, radius: 1, kind: 'projectile',
    }).tier !== 'hidden'), effectBudget.missiles, m => renderView.sample({
      position: { x: m.position[0], y: m.position[1], z: m.position[2] }, radius: 1, kind: 'projectile',
    }).importance)
    live.forEach((m, i) => {
      missilePool.show(i,
                       { x: m.position[0], y: m.position[1], z: m.position[2] },
                       { x: m.velocity[0], y: m.velocity[1], z: m.velocity[2] },
                       m.weapon)
    })
    missilePool.hideFrom(live.length)

    zoneVisuals.forEach((visual, i) => {
      const z = snapshot.zones[i]
      if (z) {
        const view           = renderView.sample({ position: visual.group.position, radius: 24, kind: 'zone' })
        visual.group.visible = view.tier !== 'hidden'
        if (view.update)
          visual.update(z.owner, z.capturing, z.progress, z.contested, elapsed)
      }
    })
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
    post: post.options,

    gameModuleFactory: (physics, _isVehicleCollider, telemetry, controls, vehicleRef, rig) => {
      // The sight casts against the same world the sim does, through one reused
      // ray — it runs every frame the HUD redraws.
      world    = physics.world
      sightRay = new physics.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })

      // The ONE body in this world besides the arena: the predicted local ship.
      // Everyone else is an interpolated transform with no physics at all,
      // because their motion is the server's to decide and simulating it here
      // would only produce a second, disagreeing answer.
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

      let clientTick    = 0
      let lastSnapshot  = 0
      let lastAimCommit = -1

      /**
       * Publish connection health, and raise the alarm once if it is fatal.
       *
       * A join that never lands used to show `SYNCING` forever — the same thing
       * a healthy handshake shows. Battle already draws a full error overlay;
       * it just had nothing that could ever trigger it.
       */
      const reportNet = () => {
        const stats = transport.stats()
        const store = useBattleStore.getState()
        store.setNetStats(stats)

        if (stats.linkError && store.status !== 'error')
          store.setError(`cannot reach the game server · ${stats.linkError}`)
      }

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

          const velocity       = local.chassis.linvel()
          telemetry.velocity.set(velocity.x, velocity.y, velocity.z)
          telemetry.speed      = Math.hypot(velocity.x, velocity.z)
          telemetry.boostMeter = prediction?.boost ?? 1
          telemetry.boosting   = controls.boost
          telemetry.grounded   = prediction?.grounded ?? false
          telemetry.airbrake   = prediction?.airbrake ?? 0

          const snapshot = transport.latest()
          const store    = useBattleStore.getState()

          reportNet()

          const aim = prediction?.aimNormalised ?? 0
          if (Math.abs(aim - lastAimCommit) > 0.01) {
            lastAimCommit = aim
            store.setAimPitch(aim)
          }

          if (!snapshot || !server)
            return

          publishHud(server, snapshot)

          // Nothing writes `telemetry.shake` any more — the module that used to
          // is gone with the local simulation — so the base `impact` module
          // idles and the rig is driven directly from the event stream.
          const events = transport.drainEvents()
          if (events.length) {
            const names = nameOf()
            for (const event of events) {
              store.applyEvent(event, names)
              reactTo(event, rig)
            }
          }
        },
      })

      return { module: battleGameModule }
    },

    hudModuleFactory: (_shipRoot, telemetry, hudRef, controls) =>
      battleHudModule(canvas, telemetry, controls, hudRef, readSight),

    extraModules: [
      defineModule<BattleState>({
        name:  'battle-visuals',
        build: ctx => {
          for (const objective of Object.values(objectives))
            if (objective)
              ctx.scene.add(objective.group)
          for (const zone of zoneVisuals)
            ctx.scene.add(zone.group)
          ctx.scene.add(shipRoot, overlays, beamPool.group, missilePool.group, blastPool.group)
        },
      }),
    ],

    onFrame: frame => {
      const elapsed = frame.elapsed
      renderView.beginFrame(app.ctx.camera as THREE.PerspectiveCamera, canvas.clientHeight || canvas.height)

      // Motion blur rides ground speed rather than the boost flag, so coasting
      // fast still streaks and tapping boost from a standstill does not.
      const lv = prediction?.rig.chassis.linvel()
      post.setSpeed(lv ? Math.hypot(lv.x, lv.z) / vehicleConfig.maxSpeed : 0)

      const sceneryView = renderView.sample({ position: { x: 0, y: 0, z: 0 }, radius: 900, kind: 'scenery' })
      if (sceneryView.update)
        scenery?.update(elapsed)
      blastPool.update(frame.delta, (position, radius) =>
        renderView.sample({ position, radius, kind: 'explosion' }).tier !== 'hidden')

      renderRemotes(elapsed)

      // Stepped on the RENDER delta, not the sim step: these are visuals whose
      // authoritative outcome the server already decided, and a missile that
      // stutters between physics ticks reads as a dropped frame.
      projectiles.step(frame.delta, id => {
        const remote = transport.remotes().find(r => r.id === id)
        if (remote)
          return { x: remote.state.x, y: remote.state.y, z: remote.state.z }

        const local = transport.localState()
        return local && local.id === id ? { x: local.x, y: local.y, z: local.z } : null
      })

      const snapshot = transport.latest()
      if (snapshot)
        renderWorld(snapshot, elapsed)
    },

    onDispose: () => {
      projectiles.clear()
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('contextmenu', onContextMenu)

      for (const id of [ ...opponents.keys() ])
        dropOpponent(id)
      for (const objective of Object.values(objectives))
        objective?.dispose()
      for (const zone of zoneVisuals)
        zone.dispose()
      beamPool.dispose()
      missilePool.dispose()
      blastPool.dispose()
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
