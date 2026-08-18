import * as THREE from 'three'
import type { App, AppModule } from 'threejs-scene'
import { defineModule } from 'threejs-scene'
import { apexArena, BATTLE_TEAMS, TEAM_COLORS } from '../battle/arena'
import type { BattleTeam } from '../battle/arena'
import { BattleSim } from '../battle/sim'
import type { BattlePlayer } from '../battle/sim'
import { WEAPONS } from '../battle/weapons'
import type { Loadout } from '../battle/weapons'
import {
  buildBeamPool,
  buildCaretMarker,
  buildMissilePool,
  buildNameplate,
  buildObjective,
  buildZoneVisual
} from '../battle/visuals'
import type { CaretMarker, Nameplate, ObjectiveVisual, ZoneVisual } from '../battle/visuals'
import { calculateActionHash, verifyActionHash } from '../battle/hash'
import type { ServerAction } from '../battle/hash'
import { BodyInterpolator } from '../interpolation'
import { useBattleStore } from '@/hooks/use-battle-store'
import { IDLE_LOCK } from '@/hooks/use-battle-store'
import type { ShipId } from '@/lib/ship/registry'
import { mountBaseScene } from './base'


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
const BEAM_POOL    = 48
const MISSILE_POOL = 64

/**
 * Opponent hull.
 *
 * Deliberately procedural rather than a loaded ship: a battle can hold a dozen
 * hulls, and the FBX path clones geometry AND textures per instance. This is
 * one draw call's worth of boxes that still reads as a ship at 100 m.
 */
function buildShipHull (team: BattleTeam): THREE.Group {
  const color = new THREE.Color(TEAM_COLORS[team])
  const root  = new THREE.Group()

  // Sized to the actual collider (1.0 × 0.225 × 2.65 half-extents) rather than
  // eyeballed: a hull visibly wider than the body it wraps makes every near
  // miss look like a hit.
  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.55, 2.6),
    new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.4), metalness: 0.6, roughness: 0.38 })
  )
  chassis.position.y = 0.5
  root.add(chassis)

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.55, 1.3, 6),
    new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.75), metalness: 0.45, roughness: 0.4 })
  )
  nose.rotation.x = Math.PI / 2
  nose.position.set(0, 0.5, 1.7)
  root.add(nose)

  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.4, 12, 8),
    new THREE.MeshStandardMaterial({ color: '#0d0f18', metalness: 0.9, roughness: 0.12 })
  )
  canopy.scale.set(0.85, 0.7, 1.2)
  canopy.position.set(0, 0.78, 0.2)
  root.add(canopy)

  for (const x of [ -1.05, 1.05 ]) {
    const fin = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.18, 1.7),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, metalness: 0.5, roughness: 0.4 })
    )
    fin.position.set(x, 0.4, -0.3)
    root.add(fin)
  }

  const skirt = new THREE.Mesh(
    new THREE.BoxGeometry(1.25, 0.1, 2.2),
    new THREE.MeshStandardMaterial({ color: '#05060a', metalness: 0.2, roughness: 0.8 })
  )
  skirt.position.y = 0.08
  root.add(skirt)

  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.3),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, toneMapped: false })
  )
  glow.position.set(0, 0.45, -1.35)
  root.add(glow)

  root.traverse(o => {
    o.castShadow    = true
    o.receiveShadow = true
  })
  return root
}

type Opponent = {
  root:      THREE.Group;
  nameplate: Nameplate;
  caret:     CaretMarker;
}

const _pose = new THREE.Vector3()
const _quat = new THREE.Quaternion()

/**
 * The battle scene composition root extending `mountBaseScene`.
 *
 * Physics and game rules run locally in `BattleSim`; every rule-changing event
 * is hashed and checked against the (currently local) authority, which is the
 * seam a real server drops into. Rendering never reads the sim's arrays
 * directly into React — HUD state goes through `useBattleStore`, throttled by
 * that store's own equality checks.
 */
export async function mountBattle (
  canvas: HTMLCanvasElement,
  name = 'Pilot',
  shipId: ShipId = 'icaras',
  loadout?: Partial<Loadout>
): Promise<App<BattleState>> {
  const arena = apexArena()
  const sim   = await BattleSim.create(arena)

  const localTeam: BattleTeam = 'red'
  const localPlayer           = sim.addPlayer(name, localTeam, shipId)
  if (loadout)
    sim.setLoadout(localPlayer.id, loadout)

  // A five-point arena needs bodies on it, or every zone is uncontested and the
  // capture rules never get exercised.
  for (let i = 0; i < 3; i++) {
    sim.addBot('blue')
    if (i > 0)
      sim.addBot('red')
  }

  useBattleStore.getState().resetSession()
  useBattleStore.getState().joined({
    playerId: localPlayer.id,
    team:     localTeam,
    shipId,
    name,
  })

  // Start immediately so driving controls are live on arrival.
  sim.start(0)

  let firePrimary   = false
  let fireSecondary = false

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'KeyF') {
      firePrimary = true
      e.preventDefault()
    }
    else if (e.code === 'KeyX') {
      fireSecondary = true
      e.preventDefault()
    }
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'KeyF')
      firePrimary = false
    else if (e.code === 'KeyX')
      fireSecondary = false
  }

  // Mouse: left drag already steers, so the triggers ride the OTHER two buttons.
  const onPointerDown = (e: PointerEvent) => {
    if (e.button === 2)
      fireSecondary = true
    else if (e.button === 1)
      firePrimary = true
  }
  const onPointerUp = (e: PointerEvent) => {
    if (e.button === 2)
      fireSecondary = false
    else if (e.button === 1)
      firePrimary = false
  }
  const onContextMenu = (e: Event) => e.preventDefault()

  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keyup', onKeyUp)
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

  const beamPool    = buildBeamPool(BEAM_POOL)
  const missilePool = buildMissilePool(MISSILE_POOL)

  const opponents = new Map<string, Opponent>()
  const shipRoot  = new THREE.Group()
  const overlays  = new THREE.Group()

  // The local ship needs its own caret target too — for the ONE enemy the local
  // player is tracking, drawn around that enemy, not around us.
  let tickCount = 0

  const zoneViews = () => sim.zones.map(z => ({
    id:        z.def.id,
    name:      z.def.name,
    short:     z.def.short,
    owner:     z.owner,
    progress:  z.progress,
    capturing: z.capturing,
    contested: z.contested,
  }))

  const nameOf = () => new Map(sim.players.map(p => [ p.id, p.name ]))

  function ensureOpponent (player: BattlePlayer): Opponent {
    let entry = opponents.get(player.id)
    if (entry)
      return entry

    const root      = buildShipHull(player.team)
    const nameplate = buildNameplate()
    const caret     = buildCaretMarker()
    root.add(nameplate.sprite)
    shipRoot.add(root)
    overlays.add(caret.group)

    entry = { root, nameplate, caret }
    opponents.set(player.id, entry)
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

  const app = await mountBaseScene<BattleState>({
    canvas,
    initialState:            initialBattleState(),
    background:              new THREE.Color(arena.background),
    bloom:                   arena.bloom,
    colliders:               arena.colliders,
    colliderOffset:          arena.colliderOffset,
    useDefaultVehicleModule: false,
    // The deck's diagonal is ~850 units; the race rig's 400 far plane would
    // clip the far wall clean off.
    cameraFar:               1600,
    buildGeometry:           ctx => {
      arena.buildVisual(ctx)
    },
    gameModuleFactory: (physics, _isVehicleCollider, _telemetry, controls, vehicleRef, rig) => {
      const localInterpolator = new BodyInterpolator(localPlayer.chassis)
      physics.interpolators.push(localInterpolator)

      vehicleRef.current = {
        get body () {
          return localPlayer.chassis
        },
        get interpolator () {
          return localInterpolator
        },
        get controller () {
          return localPlayer.controller
        },
        get debug () {
          return null
        },
        teleportTo (transform, liftY = 1) {
          localPlayer.chassis.setTranslation({ x: transform.position[0], y: transform.position[1] + liftY, z: transform.position[2] }, true)
          localPlayer.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true)
          localPlayer.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true)
          localInterpolator.teleport()
          rig.requestSnap()
        },
      }

      const battleGameModule: AppModule<BattleState> = defineModule<BattleState>({
        name: 'battle-sim-logic',
        build () {},
        update (state) {
          tickCount++

          sim.setInput(localPlayer.id, {
            steer:         state.steer,
            throttle:      state.throttle,
            brake:         state.brake,
            boost:         state.boost,
            fire:          firePrimary,
            fireSecondary: fireSecondary,
            reverse:       controls.reverse,
            strafe:        controls.strafe,
            resetSeq:      state.resetSeq,
          })

          sim.step(1 / 60)

          const snap   = sim.snapshot()
          const events = sim.drainEvents()
          const store  = useBattleStore.getState()

          // --- lock-on readout ---
          const lock   = localPlayer.lock
          const target = lock.targetId ? sim.getPlayer(lock.targetId) : undefined
          if (target) {
            const pt = localPlayer.chassis.translation()
            const tt = target.chassis.translation()
            store.setLockOn({
              phase:    lock.phase,
              targetId: target.id,
              name:     target.name,
              distance: Math.hypot(tt.x - pt.x, tt.y - pt.y, tt.z - pt.z),
              team:     target.team,
              progress: lock.progress,
            })
          }
          else
            store.setLockOn(IDLE_LOCK)

          store.setPilot({
            health:    localPlayer.health,
            maxHealth: localPlayer.maxHealth,
            boost:     localPlayer.boostMeter,
            kills:     localPlayer.kills,
            deaths:    localPlayer.deaths,
            carrying:  localPlayer.carriedFlag,
          })

          const primarySpec   = WEAPONS[localPlayer.loadout.primary]
          const secondarySpec = WEAPONS[localPlayer.loadout.secondary]
          store.setWeapons(
            { id: primarySpec.id, cooldown: localPlayer.cooldown.primary / primarySpec.cooldown, needsLock: primarySpec.needsLock },
            { id: secondarySpec.id, cooldown: localPlayer.cooldown.secondary / secondarySpec.cooldown, needsLock: secondarySpec.needsLock }
          )

          if (events.length) {
            const names = nameOf()
            for (const e of events) {
              store.applyEvent(e, names)

              const localSnapshot = {
                scores:      snap.scores,
                status:      snap.status,
                playerCount: snap.players.length,
                eventType:   e.type,
              }

              // Compute the authority's hash directly. Deriving it by calling
              // `verifyActionHash` with an empty hash "worked", but that call
              // console.warns on every mismatch — so every single event logged
              // a verification failure that had not actually happened.
              const mockServerAction: ServerAction = {
                tick:    tickCount,
                type:    e.type,
                payload: e as Record<string, unknown>,
                hash:    calculateActionHash(e.type, tickCount, e as Record<string, unknown>, localSnapshot),
              }

              const vResult = verifyActionHash(mockServerAction, localSnapshot)
              store.setVerification({
                tick:    vResult.tick,
                hash:    vResult.serverHash,
                matched: vResult.matched,
              })
            }
          }

          store.setRoster(
            sim.players.map(p => ({
              id:     p.id,
              name:   p.name,
              team:   p.team,
              isBot:  p.isBot,
              kills:  p.kills,
              deaths: p.deaths,
            }))
          )

          store.setChrome({
            status:      snap.status,
            countdown:   snap.countdown,
            timeLeft:    Math.round(snap.timeLeft),
            scores:      snap.scores,
            scoreTarget: sim.config.scoreTarget,
            zones:       zoneViews(),
            flags:       snap.flags.map(f => ({
              team:      f.team,
              state:     f.state,
              carrierId: f.carrierId,
            })),
          })
        },
      })

      return { module: battleGameModule }
    },

    extraModules: [
      defineModule<BattleState>({
        name:  'battle-visuals',
        build: ctx => {
          for (const objective of Object.values(objectives))
            if (objective)
              ctx.scene.add(objective.group)
          for (const zone of zoneVisuals)
            ctx.scene.add(zone.group)
          ctx.scene.add(shipRoot, overlays, beamPool.group, missilePool.group)
        },
      }),
    ],

    onFrame: frame => {
      const elapsed = frame.elapsed

      // --- opponents ---
      for (const p of sim.players) {
        if (p.id === localPlayer.id)
          continue

        const entry = ensureOpponent(p)
        const t     = p.chassis.translation()
        const q     = p.chassis.rotation()
        _pose.set(t.x, t.y, t.z)
        _quat.set(q.x, q.y, q.z, q.w)
        entry.root.position.copy(_pose)
        entry.root.quaternion.copy(_quat)
        entry.nameplate.set(p.name, p.health, p.maxHealth, p.team, p.carriedFlag !== null)

        // The caret only ever appears on the ONE ship the local player's lock
        // is working on — a bracket on every enemy is wallpaper, not a target.
        const lock    = localPlayer.lock
        const tracked = lock.targetId === p.id && p.team !== localPlayer.team
        entry.caret.setVisible(tracked && lock.phase !== 'idle')
        if (tracked) {
          entry.caret.group.position.set(t.x, t.y + 1.4, t.z)
          entry.caret.group.updateMatrixWorld()
          entry.caret.update(app.ctx.camera, lock.progress, lock.phase === 'locked', true, elapsed)
        }
      }

      for (const id of [ ...opponents.keys() ])
        if (!sim.players.some(p => p.id === id))
          dropOpponent(id)

      // --- objectives ---
      for (const team of BATTLE_TEAMS) {
        const visual = objectives[team]
        const state  = sim.flags.find(f => f.team === team)
        if (!visual || !state)
          continue
        visual.group.position.set(state.position[0], state.position[1], state.position[2])
        visual.update(elapsed, state.state === 'carried')
      }

      // --- weapons ---
      sim.beams.forEach((b, i) => {
        const spec = WEAPONS[b.weapon]
        // Fade over the beam's remaining life so a hit reads as a flash, not a
        // rod that blinks out.
        beamPool.show(i, { x: b.from[0], y: b.from[1], z: b.from[2] }, { x: b.to[0], y: b.to[1], z: b.to[2] },
                      b.weapon, Math.max(0, Math.min(1, b.life / (spec.beamLife ?? 0.1))))
      })
      beamPool.hideFrom(sim.beams.length)

      sim.missiles.forEach((m, i) => {
        missilePool.show(i,
                         { x: m.position[0], y: m.position[1], z: m.position[2] },
                         { x: m.velocity[0], y: m.velocity[1], z: m.velocity[2] },
                         m.weapon)
      })
      missilePool.hideFrom(sim.missiles.length)

      // --- control points ---
      zoneVisuals.forEach((visual, i) => {
        const z = sim.zones[i]
        if (z)
          visual.update(z.owner, z.capturing, z.progress, z.contested, elapsed)
      })
    },

    onDispose: () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
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
      sim.dispose()
    },
  })

  return app
}
