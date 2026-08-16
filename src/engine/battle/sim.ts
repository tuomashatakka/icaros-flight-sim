import { Quaternion, Vector3 } from 'three'
import { initRapier } from '../rapier'
import { createPhysics } from '../physics/world'
import { attachBoxColliders } from '../physics/colliders'
import { stepHovercraft, createHovercraft, createHovercraftState } from '../sim/vehicle-step'
import type { Physics } from '../physics/world'
import type { ShipId } from '@/lib/ship/registry'
import { vehicleConfig } from '@/lib/utils'
import { DEFAULT_TUNING } from '../state'
import { apexArena } from './arena'
import type { ArenaTransform, BattleArena, BattleTeam, ControlPointDef } from './arena'
import { botInput } from './bot'


export type BattleStatus = 'lobby' | 'countdown' | 'live' | 'finished'

export type BattleInput = {
  steer:    number;
  throttle: boolean;
  brake:    boolean;
  boost:    boolean;
  fire:     boolean;
  reverse?: boolean;
  strafe?:  number;
  resetSeq: number;
}

export const NEUTRAL_INPUT: BattleInput = { steer: 0, throttle: false, brake: false, boost: false, fire: false, reverse: false, strafe: 0, resetSeq: 0 }

export type BattlePlayer = {
  id:           string;
  name:         string;
  team:         BattleTeam;
  shipId:       ShipId;
  isBot:        boolean;
  health:       number;
  maxHealth:    number;
  chassis:      import('@dimforge/rapier3d-compat').RigidBody;
  controller:   import('@dimforge/rapier3d-compat').DynamicRayCastVehicleController;
  sim:          import('../sim/vehicle-step').HovercraftState;
  controls:     BattleInput;
  boostMeter:   number;
  stun:         number;
  fireCooldown: number;
  carriedFlag:  BattleTeam | null;
  respawnIndex: number;
  lastResetSeq: number;
}

export type BattleFlagState = 'home' | 'carried' | 'dropped'

export type BattleFlag = {
  team:      BattleTeam;
  state:     BattleFlagState;
  carrierId: string | null;
  position:  [number, number, number];
  returnIn:  number;

  // Grace period after a drop before ANYONE can re-pick it — stops the stunned
  //  carrier instantly re-catching the flag that just landed at their feet.
  noPickup: number;
}

export type BattleZone = {
  def:        ControlPointDef;
  owner:      BattleTeam | null;
  progress:   number; // 0..1 ownership toward `owner`; 1 = fully captured
  scoreAccum: number;
}

export type Bolt = {
  shooterId: string;
  team:      BattleTeam;
  position:  [number, number, number];
  velocity:  [number, number, number];
  life:      number;

  /** Locked-on target on the first tick; null = no lock (checks all enemies). */
  targetId: string | null;
}

export type BattleSnapshot = {
  tick:      number;
  status:    BattleStatus;
  countdown: number;
  timeLeft:  number;
  scores:    Record<BattleTeam, number>;
  players:   Array<{
    id:        string;
    team:      BattleTeam;
    name:      string;
    shipId:    ShipId;
    health:    number;
    maxHealth: number;
    x:         number;
    y:         number;
    z:         number;
    qx:        number;
    qy:        number;
    qz:        number;
    qw:        number;
    boost:     number;
    stun:      number;
    spin:      number; // weapon cooldown ratio 0..1
  }>;
  zones: Array<{ id: string; owner: BattleTeam | null; progress: number }>;
  flags: Array<{
    team:      BattleTeam;
    state:     BattleFlagState;
    carrierId: string | null;
    x:         number;
    y:         number;
    z:         number;
  }>;
  bolts: Array<{ x: number; y: number; z: number; team: BattleTeam }>;
}

export type BattleEvent =
  | { type: 'fire'; id: string; x: number; y: number; z: number; team: BattleTeam } |
  { type: 'hit'; target: string; hitBy: string } |
  { type: 'tag'; target: string; hitBy: string } |
  { type: 'flagTaken'; team: BattleTeam; by: string } |
  { type: 'flagDropped'; team: BattleTeam; x: number; z: number } |
  { type: 'flagReturned'; team: BattleTeam } |
  { type: 'flagScored'; team: BattleTeam; by: string; score: number } |
  { type: 'zoneChange'; id: string; owner: BattleTeam | null } |
  { type: 'matchStart' } |
  { type: 'matchEnd'; scores: Record<BattleTeam, number> }

export type BattleConfig = {
  matchTime:        number;
  scoreTarget:      number;
  captureBonus:     number;
  zoneScore:        number;
  stunDuration:     number;
  contactSpeed:     number;
  flagPickupRadius: number;
  baseRadius:       number;
  bolt:             { cooldown: number; speed: number; life: number; hitRadius: number };
  homingRate:       number;
}

export const DEFAULT_BATTLE_CONFIG: BattleConfig = {
  matchTime:        120,
  scoreTarget:      10,
  captureBonus:     3,
  zoneScore:        1,
  stunDuration:     0.8,
  contactSpeed:     26,
  flagPickupRadius: 6,
  baseRadius:       18,
  bolt:             { cooldown: 1.5, speed: 95, life: 2.0, hitRadius: 3.0 },
  homingRate:       3.2,
}

export const SPAWN_LIFT = 1

// Hoisted scratch, module scope: one sim runs one world at a time, and these
// are reused every tick so the hot path allocates nothing.
const _fwd      = new Vector3()
const _toTarget = new Vector3()
const _tmp3     = new Vector3()
const _boltVel  = new Vector3()
const _tmpQuat  = new Quaternion()

function mulberry32 (seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = a + 0x6d2b79f5 | 0

    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

function distSq2D (ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx
  const dz = az - bz
  return dx * dx + dz * dz
}

/**
 * The headless battle sim.
 *
 * One Rapier world, N hovercraft (humans + bots), three control zones, two
 * flags. Stepped at 1/60; the server is the ONLY writer of input, so scoring
 * and capture are authoritative by construction. Node-safe: imports only
 * `three` + rapier, never zustand or the browser. Deterministic within the
 * process (seeded rng, no timers), so battle rules are unit-testable.
 */
export class BattleSim {
  readonly arena:   BattleArena
  readonly config:  BattleConfig
  readonly players: BattlePlayer[] = []

  readonly flags: BattleFlag[]
  readonly zones: BattleZone[]
  readonly bolts: Bolt[] = []

  status:    BattleStatus = 'lobby'
  countdown: number = 0
  elapsed:   number = 0
  scores:    Record<BattleTeam, number> = { red: 0, blue: 0 }

  private physics:    Physics
  private events:     BattleEvent[] = []
  private tickNo:     number = 0
  private idSeq:      number = 0
  private botSeq:     number = 0
  private rng:        () => number
  private matchEnded: boolean = false

  private constructor (arena: BattleArena, config: BattleConfig, physics: Physics) {
    this.arena   = arena
    this.config  = config
    this.physics = physics
    this.rng     = mulberry32(1337)

    this.flags  = ([ 'red', 'blue' ] as BattleTeam[]).map(team => ({
      team,
      state:     'home',
      carrierId: null,
      position:  [ ...arena.bases[team].flagRest ] as [number, number, number],
      returnIn:  0,
      noPickup:  0,
    }))

    this.zones = arena.controlPoints.map(def => ({
      def,
      owner:      null,
      progress:   0,
      scoreAccum: 0,
    }))

    attachBoxColliders(physics, arena.colliders, arena.colliderOffset)
  }

  /** Boot the WASM, build the world, construct the sim. */
  static async create (arena: BattleArena = apexArena(), config: BattleConfig = DEFAULT_BATTLE_CONFIG): Promise<BattleSim> {
    const RAPIER  = await initRapier()
    const physics = createPhysics(RAPIER)
    return new BattleSim(arena, config, physics)
  }

  get teamSizes (): Record<BattleTeam, number> {
    const counts: Record<BattleTeam, number> = { red: 0, blue: 0 }
    for (const p of this.players)
      if (!p.isBot)
        counts[p.team]++
    return counts
  }

  private spawnFor (player: BattlePlayer): ArenaTransform {
    const lane = this.arena.spawns[player.team]
    return lane[player.respawnIndex % lane.length]
  }

  addPlayer (name: string, team: BattleTeam, shipId: ShipId): BattlePlayer {
    const player = this.buildShell(`p${this.idSeq++}`, name, team, shipId, false)
    this.players.push(player)
    return player
  }

  addBot (team: BattleTeam): BattlePlayer {
    const player = this.buildShell(`bot:${this.botSeq++}`, `Bot ${this.botSeq}`, team, 'ag-systems', true)
    this.players.push(player)
    return player
  }

  getPlayer (id: string): BattlePlayer | undefined {
    return this.players.find(p => p.id === id)
  }

  removePlayer (id: string): void {
    const idx = this.players.findIndex(p => p.id === id)
    if (idx < 0)
      return

    const player = this.players[idx]
    this.deleteShell(player)
    this.players.splice(idx, 1)
  }

  private buildShell (
    id: string,
    name: string,
    team: BattleTeam,
    shipId: ShipId,
    isBot: boolean
  ): BattlePlayer {
    const at  = this.arena.spawns[team][0]
    const rig = createHovercraft(this.physics.world, at)
    return {
      id,
      name,
      team,
      shipId,
      isBot,
      health:       100,
      maxHealth:    100,
      chassis:      rig.chassis,
      controller:   rig.controller,
      sim:          createHovercraftState(),
      controls:     { ...NEUTRAL_INPUT },
      boostMeter:   1,
      stun:         0,
      fireCooldown: 0,
      carriedFlag:  null,
      respawnIndex: 0,
      lastResetSeq: 0,
    }
  }

  private deleteShell (player: BattlePlayer): void {
    this.physics.world.removeVehicleController(player.controller)
    this.physics.world.removeRigidBody(player.chassis)
  }

  setInput (id: string, input: BattleInput): void {
    const player = this.getPlayer(id)
    if (player && !player.isBot)
      player.controls = input
  }

  start (countdown = 3): void {
    this.status    = 'countdown'
    this.countdown = countdown
    this.elapsed   = 0
    this.scores    = { red: 0, blue: 0 }
    this.events.push({ type: 'matchStart' })
  }

  dispose (): void {
    for (const player of this.players)
      this.deleteShell(player)
    this.players.length = 0
    this.physics.free()
  }

  drainEvents (): BattleEvent[] {
    const out   = this.events
    this.events = []
    return out
  }

  /** Called by the server every tick. dt is pre-scaled STEP. */
  step (dt: number): void {
    this.tickNo++

    if (this.status === 'countdown') {
      this.countdown -= dt
      if (this.countdown <= 0) {
        this.status    = 'live'
        this.countdown = 0
      }
    }

    const live       = this.status === 'live'
    const allowDrive = live

    for (const player of this.players) {
      let controls = player.controls
      if (player.isBot)
        controls = botInput(this, player, this.tickNo, this.rng, dt)

      if (player.stun > 0) {
        player.stun = Math.max(0, player.stun - dt)
        controls = { ...NEUTRAL_INPUT, resetSeq: controls.resetSeq }
      }

      player.fireCooldown = Math.max(0, player.fireCooldown - dt)

      let resetRequested = false
      if (controls.resetSeq !== player.lastResetSeq) {
        player.lastResetSeq = controls.resetSeq
        resetRequested = true
      }

      const stepOut  = stepHovercraft({
        chassis:     player.chassis,
        controller:  player.controller,
        input:       controls,
        tuning:      DEFAULT_TUNING,
        state:       player.sim,
        dt,
        allowDrive,
        spawn:       this.spawnFor(player),
        resetRequested,
        boostMeter:  player.boostMeter,
        targetSpeed: vehicleConfig.maxSpeed,
      })

      player.boostMeter = stepOut.boostMeter

      if (stepOut.respawned) {
        player.respawnIndex++
        player.stun = 0
        this.returnCarriedFlag(player)
      }

      if (live && controls.fire && player.fireCooldown <= 0)
        this.fireWeapon(player)
    }

    this.physics.world.step()

    if (!live) {
      this.integrateCarriedFlags()
      return
    }

    this.stepBolts(dt)
    this.stepContactTags()
    this.stepZones(dt)
    this.stepFlags(dt)
    this.integrateCarriedFlags()

    this.checkEnd()
  }

  private fireWeapon (player: BattlePlayer): void {
    const { bolt }      = this.config
    player.fireCooldown = bolt.cooldown

    const q    = player.chassis.rotation()
    _tmpQuat.set(q.x, q.y, q.z, q.w)
    _fwd.set(0, 0, 1).applyQuaternion(_tmpQuat)
    _boltVel.copy(_fwd).multiplyScalar(bolt.speed)

    const boltPos: [number, number, number] = [
      player.chassis.translation().x + _fwd.x * 2.5,
      player.chassis.translation().y + 0.2,
      player.chassis.translation().z + _fwd.z * 2.5,
    ]

    const t = player.chassis.translation()
    this.bolts.push({
      shooterId: player.id,
      team:      player.team,
      position:  boltPos,
      velocity:  [ _boltVel.x, _boltVel.y, _boltVel.z ],
      life:      bolt.life,
      targetId:  this.nearestEnemy(player)?.id ?? null,
    })

    this.events.push({ type: 'fire', id: player.id, x: t.x, y: t.y, z: t.z, team: player.team })
  }

  nearestEnemy (player: BattlePlayer): BattlePlayer | null {
    let best: BattlePlayer | null = null
    let bestD                     = Number.POSITIVE_INFINITY
    const t   = player.chassis.translation()
    for (const p of this.players)
      if (p.team !== player.team) {
        const pt = p.chassis.translation()
        const d  = distSq2D(t.x, t.z, pt.x, pt.z)
        if (d < bestD) {
          bestD = d
          best = p
        }
      }
    return best
  }

  private stepBolts (dt: number): void {
    const { bolt, homingRate } = this.config

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]
      b.life -= dt

      const target = b.targetId ? this.getPlayer(b.targetId) : null
      if (target) {
        const tt   = target.chassis.translation()
        _toTarget.set(tt.x - b.position[0], tt.y - b.position[1], tt.z - b.position[2])

        const mag = _toTarget.length()
        if (mag > 1e-3)
          _toTarget.normalize()
        b.velocity[0] += _toTarget.x * homingRate * bolt.speed * dt
        b.velocity[1] += _toTarget.y * homingRate * bolt.speed * dt
        b.velocity[2] += _toTarget.z * homingRate * bolt.speed * dt
      }

      b.position[0] += b.velocity[0] * dt
      b.position[1] += b.velocity[1] * dt
      b.position[2] += b.velocity[2] * dt

      const travelledSq = b.position[0] * b.position[0] + b.position[1] * b.position[1] + b.position[2] * b.position[2]
      let dead = b.life <= 0 || travelledSq > bolt.speed * bolt.speed * bolt.life * bolt.life * 4

      let hitPlayer: BattlePlayer | null = null
      if (!dead) {
        const candidates = target ? [ target ] : this.players.filter(p => p.team !== b.team)
        for (const p of candidates) {
          const tt = p.chassis.translation()
          if (distSq2D(b.position[0], b.position[2], tt.x, tt.z) < bolt.hitRadius * bolt.hitRadius) {
            hitPlayer = p
            break
          }
        }
      }

      if (hitPlayer) {
        dead = true
        this.applyHit(hitPlayer, b.shooterId, 'hit')
      }

      if (dead)
        this.bolts.splice(i, 1)
    }
  }

  private applyHit (target: BattlePlayer, hitBy: string, kind: 'hit' | 'tag'): void {
    const damage  = kind === 'hit' ? 35 : 15
    target.health = Math.max(0, target.health - damage)
    target.stun   = Math.max(target.stun, this.config.stunDuration)

    this.events.push({ type: kind, target: target.id, hitBy })

    if (target.carriedFlag)
      this.dropFlag(target.carriedFlag, target)

    if (target.health <= 0) {
      target.health       = target.maxHealth
      target.respawnIndex++
      target.stun   = 0

      const spawnAt = this.spawnFor(target)
      target.chassis.setTranslation({ x: spawnAt.position[0], y: spawnAt.position[1] + 1, z: spawnAt.position[2] }, true)
      target.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true)
      target.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true)
      this.returnCarriedFlag(target)
    }
  }

  private stepContactTags (): void {
    const { contactSpeed } = this.config
    const radius           = 3.5
    for (let i = 0; i < this.players.length; i++) {
      const a = this.players[i]
      if (a.stun > 0)
        continue

      const at = a.chassis.translation()
      const av = a.chassis.linvel()
      for (let j = i + 1; j < this.players.length; j++) {
        const b = this.players[j]
        if (b.team === a.team)
          continue

        const bt = b.chassis.translation()
        if (distSq2D(at.x, at.z, bt.x, bt.z) > radius * radius)
          continue

        const bv   = b.chassis.linvel()
        const relX = av.x - bv.x
        const relZ = av.z - bv.z
        const rel  = Math.hypot(relX, relZ)
        if (rel < contactSpeed)
          continue

        // The one carrying a flag gets tagged; if neither carries, the hit
        // registers as contact only (ships already repel via rapier).
        const carrier = a.carriedFlag ? a : b.carriedFlag ? b : null
        if (carrier)
          this.applyHit(carrier, carrier === a ? b.id : a.id, 'tag')
      }
    }
  }

  private stepZones (dt: number): void {
    for (const zone of this.zones) {
      const { position, radius } = zone.def
      const present              = new Map<BattleTeam, number>()
      for (const p of this.players) {
        const t = p.chassis.translation()
        if (distSq2D(t.x, t.z, position[0], position[2]) <= (radius + 1) * (radius + 1))
          present.set(p.team, (present.get(p.team) ?? 0) + 1)
      }

      // Dominant = strictly more ships present. A tie leaves the incumbent
      // holding — otherwise a lone defender stalemates a full attack.
      let dominant: BattleTeam | null = null
      if (present.size === 1)
        dominant = present.keys().next().value as BattleTeam
      else if (present.size === 2) {
        const [ a, b ] = [ ...present.entries() ]
        if (a[1] > b[1])
          dominant = a[0]
        else if (b[1] > a[1])
          dominant = b[0]
        else if (zone.owner === a[0] || zone.owner === b[0])
          dominant = zone.owner
      }

      if (dominant)
        if (dominant === zone.owner)
          zone.progress = Math.min(1, zone.progress + dt / this.arena.captureTime); else {
          zone.progress -= dt / this.arena.captureTime
          if (zone.progress <= 0) {
            const flipTo  = dominant
            zone.owner    = flipTo
            zone.progress = 0
            this.events.push({ type: 'zoneChange', id: zone.def.id, owner: flipTo })
          }
        } else {
        zone.progress -= dt / this.arena.decayTime
        if (zone.progress <= 0) {
          if (zone.owner !== null)
            this.events.push({ type: 'zoneChange', id: zone.def.id, owner: null })
          zone.owner    = null
          zone.progress = 0
        }
      }

      // Scoring: a fully-captured zone ticks +1 every zonePeriod.
      if (zone.owner && zone.progress >= 1) {
        zone.scoreAccum += dt
        while (zone.scoreAccum >= this.arena.zonePeriod) {
          zone.scoreAccum -= this.arena.zonePeriod
          this.scores[zone.owner] += this.config.zoneScore
          if (this.scores[zone.owner] >= this.config.scoreTarget)
            this.endMatch()
        }
      }
    }
  }

  private stepFlags (dt: number): void {
    const { flagPickupRadius } = this.config

    for (const flag of this.flags) {
      if (flag.state === 'carried' || flag.noPickup > 0)
        continue

      const [ fx, , fz ] = flag.position

      for (const p of this.players) {
        const t      = p.chassis.translation()
        const within = distSq2D(t.x, t.z, fx, fz) <= flagPickupRadius * flagPickupRadius
        if (!within)
          continue

        if (p.team !== flag.team) {
          // Enemy takes it.
          if (p.carriedFlag)
            continue
          flag.state     = 'carried'
          flag.carrierId = p.id
          flag.returnIn  = 0
          p.carriedFlag  = flag.team
          this.events.push({ type: 'flagTaken', team: flag.team, by: p.id })
        }
        else if (flag.state === 'dropped') {
          // Owning team touches it -> straight home.
          this.returnFlagHome(flag)
          this.events.push({ type: 'flagReturned', team: flag.team })
        }
      }
    }

    for (const flag of this.flags) {
      if (flag.state !== 'dropped')
        continue
      flag.returnIn -= dt
      flag.noPickup  = Math.max(0, flag.noPickup - dt)
      if (flag.returnIn <= 0) {
        this.returnFlagHome(flag)
        this.events.push({ type: 'flagReturned', team: flag.team })
      }
    }
  }

  private integrateCarriedFlags (): void {
    for (const flag of this.flags) {
      if (flag.state !== 'carried')
        continue

      const carrier = this.getPlayer(flag.carrierId ?? '')
      if (!carrier) {
        this.returnFlagHome(flag)
        continue
      }

      const t       = carrier.chassis.translation()
      flag.position = [ t.x, t.y + 1.4, t.z ]

      // Captured: enemy flag sitting on the carrier's OWN base scores.
      if (carrier.team !== flag.team) {
        const base = this.arena.bases[carrier.team].position
        if (distSq2D(t.x, t.z, base[0], base[2]) <= this.config.baseRadius * this.config.baseRadius) {
          const bonus    = this.config.captureBonus
          this.scores[carrier.team] += bonus
          carrier.carriedFlag = null
          this.returnFlagHome(flag)
          this.events.push({ type: 'flagScored', team: flag.team, by: carrier.id, score: this.scores[carrier.team] })
          if (this.scores[carrier.team] >= this.config.scoreTarget)
            this.endMatch()
        }
      }
    }
  }

  private dropFlag (team: BattleTeam, carrier: BattlePlayer): void {
    const flag = this.flags.find(f => f.team === team)
    if (!flag)
      return

    const t             = carrier.chassis.translation()
    flag.state          = 'dropped'
    flag.carrierId      = null
    flag.position       = [ t.x, t.y + 0.5, t.z ]
    flag.returnIn       = this.arena.flagReturnTime
    flag.noPickup       = 1.2
    carrier.carriedFlag = null
    this.events.push({ type: 'flagDropped', team, x: t.x, z: t.z })
  }

  private returnCarriedFlag (player: BattlePlayer): void {
    if (!player.carriedFlag)
      return

    const team         = player.carriedFlag
    player.carriedFlag = null
    this.returnFlagHome(this.flags.find(f => f.team === team)!)
    this.events.push({ type: 'flagReturned', team })
  }

  private returnFlagHome (flag: BattleFlag): void {
    const rest     = this.arena.bases[flag.team].flagRest
    flag.state     = 'home'
    flag.carrierId = null
    flag.position  = [ rest[0], rest[1], rest[2] ] as [number, number, number]
    flag.returnIn  = 0
    flag.noPickup  = 0
  }

  private checkEnd (): void {
    if (this.status !== 'live')
      return
    this.elapsed += 1 / 60
    if (this.elapsed >= this.config.matchTime)
      this.endMatch()
  }

  private endMatch (): void {
    if (this.matchEnded)
      return
    this.matchEnded = true
    this.status     = 'finished'
    this.events.push({ type: 'matchEnd', scores: { ...this.scores }})
  }

  snapshot (): BattleSnapshot {
    return {
      tick:      this.tickNo,
      status:    this.status,
      countdown: Math.max(0, Math.ceil(this.countdown)),
      timeLeft:  Math.max(0, this.config.matchTime - this.elapsed),
      scores:    { ...this.scores },
      players:   this.players.map(p => {
        const t = p.chassis.translation()
        const q = p.chassis.rotation()
        return {
          id:        p.id,
          team:      p.team,
          name:      p.name,
          shipId:    p.shipId,
          health:    p.health,
          maxHealth: p.maxHealth,
          x:         t.x,
          y:         t.y,
          z:         t.z,
          qx:        q.x,
          qy:        q.y,
          qz:        q.z,
          qw:        q.w,
          boost:     p.boostMeter,
          stun:      p.stun,
          spin:      p.fireCooldown / this.config.bolt.cooldown,
        }
      }),
      zones: this.zones.map(z => ({ id: z.def.id, owner: z.owner, progress: z.progress })),
      flags: this.flags.map(f => ({
        team:      f.team,
        state:     f.state,
        carrierId: f.carrierId,
        x:         f.position[0],
        y:         f.position[1],
        z:         f.position[2],
      })),
      bolts: this.bolts.map(b => ({ x: b.position[0], y: b.position[1], z: b.position[2], team: b.team })),
    }
  }
}
