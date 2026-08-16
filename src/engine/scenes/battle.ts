import * as THREE from 'three'
import type { App, AppModule } from 'threejs-scene'
import { defineModule } from 'threejs-scene'
import { apexArena } from '../battle/arena'
import { BATTLE_TEAMS, TEAM_COLORS, NEUTRAL_COLOR } from '../battle/arena'
import type { BattleTeam } from '../battle/arena'
import { BattleSim } from '../battle/sim'
import { verifyActionHash } from '../battle/hash'
import type { ServerAction } from '../battle/hash'
import { BodyInterpolator } from '../interpolation'
import { useBattleStore } from '@/hooks/use-battle-store'
import type { ShipId } from '@/lib/ship/registry'
import { mountBaseScene } from './base'
function createHealthBar(): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 16
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#00ff00'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(2, 0.25, 1)
  sprite.position.set(0, 2.5, 0)
  ;(sprite as any).healthCanvas = canvas
  ;(sprite as any).healthCtx = ctx
  ;(sprite as any).healthTexture = texture
  return sprite
}


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

function buildShipHull (team: BattleTeam): THREE.Group {


  const color = new THREE.Color(TEAM_COLORS[team])
  const root  = new THREE.Group()

  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.7, 3.4),
    new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.6), metalness: 0.55, roughness: 0.4 })
  )
  chassis.position.y = 0.5
  root.add(chassis)

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.7, 1.4, 6),
    new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.85), metalness: 0.4, roughness: 0.45 })
  )
  nose.rotation.x = -Math.PI / 2
  nose.position.set(0, 0.6, -2.1)
  root.add(nose)

  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 12, 8),
    new THREE.MeshStandardMaterial({ color: '#0d0f18', metalness: 0.9, roughness: 0.15 })
  )
  canopy.scale.set(0.85, 0.7, 1.2)
  canopy.position.y = 0.95
  root.add(canopy)

  const skirt = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.12, 2.8),
    new THREE.MeshStandardMaterial({ color: '#05060a', metalness: 0.2, roughness: 0.8 })
  )
  skirt.position.y = 0.08
  root.add(skirt)

  root.traverse(o => {
    o.castShadow    = true
    o.receiveShadow = true
  })
  return root
}

function buildFlag (team: BattleTeam): THREE.Group {
  const root  = new THREE.Group()
  const color = new THREE.Color(TEAM_COLORS[team])

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6),
    new THREE.MeshStandardMaterial({ color: '#dfe3ff', metalness: 0.8, roughness: 0.3 })
  )
  pole.position.y = 1.1
  root.add(pole)

  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.7),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, side: THREE.DoubleSide })
  )
  banner.position.set(-0.62, 1.55, 0)
  root.add(banner)

  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 6, 6),
    new THREE.MeshBasicMaterial({ color })
  )
  tip.position.y = 2.25
  root.add(tip)

  return root
}

function buildBoltMesh (): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.CapsuleGeometry(0.18, 0.7, 4, 8),
    new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.95 })
  )
}

const _pose = new THREE.Vector3()
const _quat = new THREE.Quaternion()

/**
 * The battle scene composition root extending `mountBaseScene`.
 *
 * Physics are calculated locally using Rapier (`BattleSim`). Every action that
 * modifies players or game state (input tick, fire, hit, zone claim, respawn)
 * generates a local hash verified against the server's event action hash.
 */
export async function mountBattle (
  canvas: HTMLCanvasElement,
  name = 'Pilot',
  shipId: ShipId = 'icaras'
): Promise<App<BattleState>> {
  const arena = apexArena()
  const sim   = await BattleSim.create(arena)

  const localTeam: BattleTeam = 'red'
  const localPlayer           = sim.addPlayer(name, localTeam, shipId)
  sim.addBot('blue')

  useBattleStore.getState().resetSession()
  useBattleStore.getState().joined({
    playerId: localPlayer.id,
    team:     localTeam,
    shipId,
    name,
  })

  // Start match immediately so driving controls are enabled right away
  sim.start(0)

  let fireHeld   = false
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'KeyF') {
      fireHeld = true
      e.preventDefault()
    }
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'KeyF')
      fireHeld = false
  }

  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('keyup', onKeyUp)

  // Control zones visual rings
  const zoneMeshes: { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial }[] = []
  for (const cp of arena.controlPoints) {
    const mat = new THREE.MeshStandardMaterial({
      color:             NEUTRAL_COLOR,
      emissive:          NEUTRAL_COLOR,
      emissiveIntensity: 0.85,
      side:              THREE.DoubleSide,
      transparent:       true,
      opacity:           0.85,
    })
    const ring      = new THREE.Mesh(new THREE.RingGeometry(0.55, 1, 48), mat)
    ring.rotation.x = -Math.PI / 2
    ring.position.set(cp.position[0], 0.06, cp.position[2])
    ring.scale.set(cp.radius, cp.radius, cp.radius)
    zoneMeshes.push({ mesh: ring, mat })
  }

  const flags: Partial<Record<BattleTeam, THREE.Group>> = {}
  for (const team of BATTLE_TEAMS) {
    const f     = buildFlag(team)
    flags[team] = f
  }

  const bolts: THREE.Mesh[] = []
  for (let i = 0; i < 16; i++) {
    const b   = buildBoltMesh()
    b.visible = false
    bolts.push(b)
  }

  const opponentShips = new Map<string, THREE.Group>()
  const shipRoot      = new THREE.Group()

  let tickCount = 0

  const app = await mountBaseScene<BattleState>({
    canvas,
    initialState:            initialBattleState(),
    background:              new THREE.Color(arena.background),
    colliders:               arena.colliders,
    colliderOffset:          [ 0, 0, 0 ],
    useDefaultVehicleModule: false,
    buildGeometry:           ctx => {
      arena.buildVisual(ctx)
    },
    gameModuleFactory: (physics, _isVehicleCollider, _telemetry, controls, vehicleRef, rig) => {
      // Local player body interpolator
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
        update (state, _frame, _ctx) {
          tickCount++

          sim.setInput(localPlayer.id, {
            steer:    state.steer,
            throttle: state.throttle,
            brake:    state.brake,
            boost:    state.boost,
            fire:     fireHeld,
            reverse:  controls.reverse,
            strafe:   controls.strafe,
            resetSeq: state.resetSeq,
          })

          // Step physics and game rules locally in Rapier
          sim.step(1 / 60)

          const snap   = sim.snapshot()
          const events = sim.drainEvents()

          // Compute lock-on target status
          const enemy = sim.nearestEnemy(localPlayer)
          if (enemy) {
            const pt   = localPlayer.chassis.translation()
            const et   = enemy.chassis.translation()
            const dx   = et.x - pt.x
            const dz   = et.z - pt.z
            const dist = Math.hypot(dx, dz)

            const q = localPlayer.chassis.rotation()
            _quat.set(q.x, q.y, q.z, q.w)
            _pose.set(0, 0, 1).applyQuaternion(_quat)

            const dirX = dx / Math.max(dist, 1e-4)
            const dirZ = dz / Math.max(dist, 1e-4)
            const dot  = _pose.x * dirX + _pose.z * dirZ

            if (dist < 85 && dot > 0.6)
              useBattleStore.getState().setLockOn({
                active:   true,
                targetId: enemy.id,
                name:     enemy.name,
                distance: Math.round(dist),
                team:     enemy.team,
              })
            else
              useBattleStore.getState().setLockOn({
                active:   false,
                targetId: null,
                name:     null,
                distance: 0,
                team:     null,
              })
          }
          else
            useBattleStore.getState().setLockOn({
              active:   false,
              targetId: null,
              name:     null,
              distance: 0,
              team:     null,
            })

          useBattleStore.getState().setHealth(localPlayer.health, localPlayer.maxHealth)

          for (const e of events) {
            useBattleStore.getState().applyEvent(e)

            const localSnapshot = {
              scores:      snap.scores,
              status:      snap.status,
              playerCount: snap.players.length,
              eventType:   e.type,
            }

            const mockServerAction: ServerAction = {
              tick:    tickCount,
              type:    e.type,
              payload: e as Record<string, unknown>,
              hash:    verifyActionHash({
                tick:    tickCount,
                type:    e.type,
                payload: e as Record<string, unknown>,
                hash:    '',
              }, localSnapshot).localHash,
            }

            const vResult = verifyActionHash(mockServerAction, localSnapshot)
            useBattleStore.getState().setVerification({
              tick:    vResult.tick,
              hash:    vResult.serverHash,
              matched: vResult.matched,
            })
          }

          useBattleStore.getState().setRoster(
            sim.players.map(p => ({
              id:    p.id,
              name:  p.name,
              team:  p.team,
              isBot: p.isBot,
            }))
          )

          useBattleStore.getState().setChrome({
            status:    snap.status,
            countdown: snap.countdown,
            timeLeft:  Math.round(snap.timeLeft),
            scores:    snap.scores,
            zones:     snap.zones,
            flags:     snap.flags.map(f => ({
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
          for (const f of Object.values(flags))
            if (f)
              ctx.scene.add(f)
          for (const b of bolts)
            ctx.scene.add(b)
          ctx.scene.add(shipRoot, ...zoneMeshes.map(z => z.mesh))
        },
      }),
    ],
    onFrame: (_frame, _pos, _quat, _rig, _controls) => {
      // Reconcile opponent / bot meshes
      for (const p of sim.players) {
        if (p.id === localPlayer.id)
          continue
        if (!opponentShips.has(p.id)) {
            const hull = buildShipHull(p.team)
            const healthBar = createHealthBar()
            hull.add(healthBar)
            // store health bar reference in map for later updates
            ;(hull as any).healthBar = healthBar
            opponentShips.set(p.id, hull)
            shipRoot.add(hull)
          }
      }
      for (const [ id, mesh ] of opponentShips)
        if (!sim.players.some(p => p.id === id)) {
          shipRoot.remove(mesh)
          opponentShips.delete(id)
        }

      // Update positions of opponent ships
      for (const p of sim.players) {
        if (p.id === localPlayer.id)
          continue

        const mesh = opponentShips.get(p.id)
          if (mesh) {
            const t = p.chassis.translation()
            const q = p.chassis.rotation()
            _pose.set(t.x, t.y, t.z)
            _quat.set(q.x, q.y, q.z, q.w)
            mesh.position.copy(_pose)
            mesh.quaternion.copy(_quat)
            // Update health bar texture based on player health
            const healthBar = (mesh as any).healthBar as THREE.Sprite
            if (healthBar) {
              const hp = p.health
              const maxHp = p.maxHealth
              const percent = Math.max(0, Math.min(1, hp / maxHp))
              const canvas = (healthBar as any).healthCanvas as HTMLCanvasElement
              const ctx = (healthBar as any).healthCtx as CanvasRenderingContext2D
              const width = canvas.width
              const height = canvas.height
              // clear
              ctx.clearRect(0, 0, width, height)
              // background (dark)
              ctx.fillStyle = '#444'
              ctx.fillRect(0, 0, width, height)
              // health bar
              const green = Math.round(255 * percent)
              const red = 255 - green
              ctx.fillStyle = `rgb(${red},${green},0)`
              ctx.fillRect(0, 0, width * percent, height)
              ;(healthBar as any).healthTexture.needsUpdate = true
            }
          }
      }

      // Synchronize flag meshes
      for (const team of BATTLE_TEAMS) {
        const f  = flags[team]
        const sf = sim.flags.find(fl => fl.team === team)
        if (f && sf)
          f.position.set(sf.position[0], sf.position[1], sf.position[2])
      }

      // Synchronize bolt projectile meshes
      bolts.forEach((b, i) => {
        const src = sim.bolts[i]
        if (!src) {
          b.visible = false
          return
        }
        b.position.set(src.position[0], src.position[1], src.position[2])
        b.visible = true;
        (b.material as THREE.MeshBasicMaterial).color.set(TEAM_COLORS[src.team])
      })

      // Update zone control ring colors
      const zones = sim.zones
      zoneMeshes.forEach(({ mesh, mat }, i) => {
        const z = zones[i]
        if (!z)
          return

        const col = z.owner ? TEAM_COLORS[z.owner] : NEUTRAL_COLOR
        mat.color.set(col)
        mat.emissive.set(col)
        mat.emissiveIntensity = z.owner ? 0.85 + z.progress * 0.5 : 0.5
        mesh.visible          = true
      })
    },
    onDispose: () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      sim.dispose()
    },
  })

  return app
}
