import { Quaternion, Vector3 } from 'three'
import { initRapier } from 'Φrapier'
import { createPhysics } from 'Φworld'
import { attachBoxColliders } from 'Φcolliders'
import { stepHovercraft, createHovercraft, createHovercraftState } from 'Φvehicle-step'
import type { Physics } from 'Φworld'
import type { ShipId } from 'Φships'
import { vehicleConfig } from 'Φconfig'
import { DEFAULT_TUNING } from 'Φtypes'
import { aimFrom, castArenaRay, forwardFrom, muzzleFrom } from './aim'
import { apexArena } from './arena'
import type { ArenaTransform, BattleArena, BattleTeam, ControlPointDef } from './arena'
import { botInput } from './bot'
import { advanceLock, isVisible, scanForLock } from './lock-on'
import type { LockScan } from './lock-on'
import { resolveBeamHits, resolveBlastHits } from './hitscan'
import { homeToward, spawnProjectiles } from './projectiles'
import type { HitCandidate, Vec3 } from './hitscan'
import type { ProjectileSpawn } from './projectiles'
import { respawnPosition, spawnAt } from './respawn'
import { registerKill, scoreFlagCapture, scoreTargetReached, tickZoneScore } from './scoring'
import { countOccupants, stepZone } from './zones'
import {
  DEFAULT_LOADOUT,
  WEAPONS,
  canFire,
  createLockState
} from './weapons'
import type { Loadout, LockPhase, LockState, WeaponId, WeaponSpec } from './weapons'


// Re-exported so `./sim` stays the single import site for the whole model.
export type {
  Beam,
  BattleConfig,
  BattleEvent,
  BattleFlag,
  BattleFlagState,
  BattleInput,
  BattlePlayer,
  BattleSnapshot,
  BattleStatus,
  BattleZone,
  Missile,
  WeaponSlot
} from './types'

import type {
  Beam,
  BattleConfig,
  BattleEvent,
  BattleFlag,
  BattleInput,
  BattlePlayer,
  BattleSnapshot,
  BattleStatus,
  BattleZone,
  Missile,
  WeaponSlot
} from './types'


export const NEUTRAL_INPUT: BattleInput = {
  steer:         0,
  throttle:      false,
  brake:         false,
  boost:         false,
  fire:          false,
  fireSecondary: false,
  reverse:       false,
  strafe:        0,
  aimPitch:      0,
  resetSeq:      0,
}

/** Vertical aim travel, radians/sec, and its clamp. */
// Radians per second the vertical trim wheel travels while held. Exported so
//  the client can predict the same trim rather than wait a round trip for it.
export const AIM_RATE = 0.62

export const AIM_MAX = 0.35

/**
 * Scoring is tuned so no single point can carry a match.
 *
 * Five zones ticking +1 every `zonePeriod` (6 s) means holding one is 10/min —
 * short of 60 inside the 5-minute clock — while three is 30/min and all five
 * is 50/min, i.e. a rout ends in about 70 seconds. At the old 25/4 s a team
 * that took the central spire and nothing else simply won, which is why bot
 * matches ended with four of the five points still neutral.
 */
export const DEFAULT_BATTLE_CONFIG: BattleConfig = {
  matchTime:        300,
  scoreTarget:      60,
  captureBonus:     8,
  zoneScore:        1,
  stunDuration:     0.7,
  contactSpeed:     26,
  flagPickupRadius: 7,
  baseRadius:       18,
  hullRadius:       2.6,
}

export const SPAWN_LIFT = 1

// Hoisted scratch, module scope: one sim runs one world at a time, and these
// are reused every tick so the hot path allocates nothing.
const _fwd     = new Vector3()
const _tmp3    = new Vector3()
const _dir     = new Vector3()
const _origin  = new Vector3()
const _tmpQuat = new Quaternion()
const UP       = new Vector3(0, 1, 0)

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
 * One Rapier world, N hovercraft (humans + bots), five control zones, two
 * objectives. Stepped at 1/60; the server is the ONLY writer of input, so
 * scoring and capture are authoritative by construction. Node-safe: imports
 * only `three` + rapier, never zustand or the browser. Deterministic within the
 * process (seeded rng, no timers), so battle rules are unit-testable.
 *
 * The class itself is an orchestrator: zone capture (`zones.ts`), spawn choice
 * and respawn bookkeeping (`respawn.ts`), lock acquisition and the
 * cone/visibility test (`lock-on.ts`), and score deltas plus the win check
 * (`scoring.ts`) are pure functions over this class's records. What is left
 * here is what genuinely needs the live rapier world and the player roster:
 * stepping the physics, resolving weapon fire, and the top-level tick order.
 */
export class BattleSim {
  readonly arena:   BattleArena
  readonly config:  BattleConfig
  readonly players: BattlePlayer[] = []

  readonly flags:    BattleFlag[]
  readonly zones:    BattleZone[]
  readonly beams:    Beam[] = []
  readonly missiles: Missile[] = []

  status:    BattleStatus = 'lobby'
  countdown: number = 0
  elapsed:   number = 0
  scores:    Record<BattleTeam, number> = { red: 0, blue: 0 }

  private physics:    Physics
  private events:     BattleEvent[] = []
  private tickNo:     number = 0
  private idSeq:      number = 0
  private botSeq:     number = 0
  private shotSeq:    number = 0
  private rng:        () => number
  private matchEnded: boolean = false

  /** One reusable ray — line-of-sight runs per player AND per missile per tick. */
  private ray: import('@dimforge/rapier3d-deterministic-compat').Ray

  /**
   * Where hit tests believe each ship is.
   *
   * Defaults to the live chassis, which is what a local run and every existing
   * test expect. The SERVER swaps it for a rewound pose while resolving a shot,
   * so the hit lands against what the shooter actually saw rather than against
   * where the target has moved to during the round trip — "favour the shooter",
   * the same trick Source and Overwatch use.
   */
  private poseSource: ((player: BattlePlayer) => Vec3) | null = null

  /**
   * Optional lag compensation, installed by the server.
   *
   * Given the shooter, returns the pose source their shots should resolve
   * against — a rewound view of the world — or null to use live poses. Called
   * once per player per tick, around the fire pass only, so the physics step
   * and everything else still run on the present.
   *
   * Null by default, which keeps a local run and every existing test on exactly
   * the code path they had before.
   */
  lagCompensation: ((shooter: BattlePlayer) => ((player: BattlePlayer) => Vec3) | null) | null = null

  /**
   * Resolve `resolve()` against poses from `source`.
   *
   * Scoped rather than settable so it cannot leak past the shot it belongs to:
   * a rewound pose left installed would make the NEXT tick's physics disagree
   * with its own hit tests.
   */
  withPoses<T> (source: (player: BattlePlayer) => Vec3, resolve: () => T): T {
    const previous  = this.poseSource
    this.poseSource = source
    try {
      return resolve()
    }
    finally {
      this.poseSource = previous
    }
  }

  private poseOf (player: BattlePlayer): Vec3 {
    if (this.poseSource)
      return this.poseSource(player)

    const t = player.chassis.translation()
    return { x: t.x, y: t.y, z: t.z }
  }

  /** Everything a hit test may touch, at the poses currently in force. */
  private hitCandidates (): HitCandidate[] {
    return this.players.map(player => ({
      id:       player.id,
      team:     player.team,
      position: this.poseOf(player),
    }))
  }

  private constructor (arena: BattleArena, config: BattleConfig, physics: Physics) {
    this.arena   = arena
    this.config  = config
    this.physics = physics
    this.rng     = mulberry32(1337)
    this.ray     = new physics.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 })

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
      capturing:  null,
      contested:  false,
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
    return spawnAt(this.arena, player.team, player.respawnIndex)
  }

  addPlayer (name: string, team: BattleTeam, shipId: ShipId, loadout: Loadout = DEFAULT_LOADOUT): BattlePlayer {
    const player = this.buildShell(`p${this.idSeq++}`, name, team, shipId, false, loadout)
    this.players.push(player)
    return player
  }

  addBot (team: BattleTeam, loadout: Loadout = DEFAULT_LOADOUT): BattlePlayer {
    const player = this.buildShell(`bot:${this.botSeq++}`, `Bot ${this.botSeq}`, team, 'ag-systems', true, loadout)
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
    isBot: boolean,
    loadout: Loadout
  ): BattlePlayer {
    // Start each arrival on the NEXT lane of its team's spawn. Everyone used to
    // take lane 0, so a three-strong team materialised inside one another and
    // spent the first second of the match shoving itself apart.
    const seat = this.players.filter(p => p.team === team).length
    const at   = spawnAt(this.arena, team, seat)
    const rig  = createHovercraft(this.physics.world, at)
    return {
      id,
      name,
      team,
      shipId,
      isBot,
      health:       100,
      maxHealth:    100,
      chassis:      rig.chassis,
      sim:          createHovercraftState(),
      controls:     { ...NEUTRAL_INPUT },
      boostMeter:   1,
      stun:         0,
      loadout:      { ...loadout },
      cooldown:     { primary: 0, secondary: 0 },
      lock:         createLockState(),
      aimAngle:     0,
      carriedFlag:  null,
      respawnIndex: seat,
      lastResetSeq: 0,
      kills:        0,
      deaths:       0,
    }
  }

  private deleteShell (player: BattlePlayer): void {
    this.physics.world.removeRigidBody(player.chassis)
  }

  setInput (id: string, input: BattleInput): void {
    const player = this.getPlayer(id)
    if (player && !player.isBot)
      player.controls = input
  }

  setLoadout (id: string, loadout: Partial<Loadout>): void {
    const player = this.getPlayer(id)
    if (player)
      player.loadout = { ...player.loadout, ...loadout }
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
      // Bots write their decision back onto the player: the fire pass below
      // reads `player.controls`, so a bot trigger held only in a local would
      // silently never fire.
      if (player.isBot)
        player.controls = botInput(this, player, this.tickNo, this.rng, dt)

      let controls = player.controls
      if (player.stun > 0) {
        player.stun = Math.max(0, player.stun - dt)
        controls = { ...NEUTRAL_INPUT, resetSeq: controls.resetSeq }
      }

      player.cooldown.primary   = Math.max(0, player.cooldown.primary - dt)
      player.cooldown.secondary = Math.max(0, player.cooldown.secondary - dt)

      let resetRequested = false
      if (controls.resetSeq !== player.lastResetSeq) {
        player.lastResetSeq = controls.resetSeq
        resetRequested = true
      }

      // Integrated from the held axis, not assigned from it: the aim is a trim
      // wheel, so it keeps climbing while R is down and holds when released.
      // A respawn puts you somewhere new facing something else — the old
      // elevation is meaningless there, so it goes back to level.
      if (resetRequested)
        player.aimAngle = 0
      else if (controls.aimPitch)
        player.aimAngle = Math.max(-AIM_MAX, Math.min(AIM_MAX, player.aimAngle + controls.aimPitch * AIM_RATE * dt))

      const stepOut  = stepHovercraft({
        chassis:     player.chassis,
        world:       this.physics.world,
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
        player.lock = createLockState()
        this.returnCarriedFlag(player)
      }
    }

    this.physics.world.step()

    // Locks resolve AFTER the world step so the cone test uses this tick's
    // poses — testing against last tick's made a lock lag visibly behind the
    // reticle at speed.
    for (const player of this.players)
      this.stepLock(player, dt)

    if (live)
      for (const player of this.players) {
        if (player.stun > 0)
          continue

        // Only the fire pass is rewound. A missile already in flight travelled
        // in server time, so its splash resolves against the present — and the
        // physics step above must never see a rewound pose or the world itself
        // would disagree with where it just put things.
        const rewound = this.lagCompensation?.(player) ?? null
        const fire    = () => {
          if (player.controls.fire)
            this.tryFire(player, 'primary')
          if (player.controls.fireSecondary)
            this.tryFire(player, 'secondary')
        }

        if (rewound)
          this.withPoses(rewound, fire)
        else
          fire()
      }

    this.ageBeams(dt)

    if (!live) {
      this.integrateCarriedFlags()
      return
    }

    this.stepMissiles(dt)
    this.stepContactTags()
    this.stepZones(dt)
    this.stepFlags(dt)
    this.integrateCarriedFlags()

    this.checkEnd()
  }

  // --- targeting ------------------------------------------------------------

  /**
   * Ship-forward, aim and muzzle come from `battle/aim.ts`.
   *
   * They used to be private methods here, which left the client with no way to
   * draw where the guns actually point — see the note at the top of that file.
   */
  private forwardOf (player: BattlePlayer, out: Vector3): Vector3 {
    const q = player.chassis.rotation()
    _tmpQuat.set(q.x, q.y, q.z, q.w)
    return forwardFrom(out, _tmpQuat)
  }

  private aimOf (player: BattlePlayer, out: Vector3): Vector3 {
    const q = player.chassis.rotation()
    _tmpQuat.set(q.x, q.y, q.z, q.w)
    return aimFrom(out, _tmpQuat, player.aimAngle)
  }

  private muzzleOf (player: BattlePlayer, out: Vector3): Vector3 {
    const q = player.chassis.rotation()
    _tmpQuat.set(q.x, q.y, q.z, q.w)
    return muzzleFrom(out, player.chassis.translation(), _tmpQuat)
  }

  /**
   * Distance to the first piece of ARENA between two points, or Infinity.
   *
   * Vehicles are skipped by the predicate: this answers "is a mesa in the way",
   * which is the question both the lock and the beams need. Without it every
   * plateau would be transparent to weapons and the level's cover would be
   * decoration.
   */
  private staticBlockerAt (from: Vector3, dir: Vector3, maxToi: number): number {
    return castArenaRay(this.physics.world, this.ray, from, dir, maxToi)
  }

  /** True when nothing solid stands between the two ships. */
  hasLineOfSight (from: BattlePlayer, to: BattlePlayer): boolean {
    this.muzzleOf(from, _origin)

    const t = to.chassis.translation()
    return isVisible(
      this.physics.world,
      this.ray,
      { x: _origin.x, y: _origin.y, z: _origin.z },
      { x: t.x, y: t.y, z: t.z }
    )
  }

  /**
   * Advance one ship's lock meter.
   *
   * The acquire/hold/break state machine and the crosshair scan both live in
   * `lock-on.ts`; this is the wiring — resolve the shooter's aim, skip the scan
   * entirely while not live (a scan raycasts), and resolve target ids against
   * the live roster, which only the sim can do.
   */
  private stepLock (player: BattlePlayer, dt: number): void {
    const live = this.status === 'live'
    let scan: LockScan = { targetId: null, cos: -1, visible: false }

    if (live) {
      this.aimOf(player, _fwd)
      this.muzzleOf(player, _origin)
      scan = scanForLock(
        this.physics.world,
        this.ray,
        { x: _origin.x, y: _origin.y, z: _origin.z },
        { x: _fwd.x, y: _fwd.y, z: _fwd.z },
        player.id,
        player.team,
        this.hitCandidates()
      )
    }

    const event = advanceLock(player.lock, dt, live, player.id, player.team, scan, id => {
      const target = this.getPlayer(id)
      return target ? { id: target.id, team: target.team } : undefined
    })

    if (event)
      this.events.push(event)
  }

  /** Kept for the bots and the older call sites; ignores facing entirely. */
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

  // --- weapons --------------------------------------------------------------

  private tryFire (player: BattlePlayer, slot: WeaponSlot): void {
    const spec = WEAPONS[player.loadout[slot]]
    if (!canFire(spec, player.cooldown[slot], player.lock))
      return

    player.cooldown[slot] = spec.cooldown

    const t = player.chassis.translation()

    // The spawn has to be built by the weapon that fires, so the event is
    // pushed after it rather than before — a beam has no salvo to reproduce.
    const spawn = spec.kind === 'beam' ? null : this.launchMissiles(player, spec)
    const beam  = spec.kind === 'beam' ? this.fireBeam(player, spec) : null

    this.events.push({ type: 'fire', id: player.id, weapon: spec.id, x: t.x, y: t.y, z: t.z, team: player.team, spawn, beam })
  }

  /**
   * Resolve a hitscan shot.
   *
   * The shot is a ray, so there is nothing to lead and nothing to dodge once
   * the trigger is down — which is exactly why beam weapons are the ones that
   * do NOT need a lock. Arena geometry stops the ray before any ship behind it.
   */
  private fireBeam (player: BattlePlayer, spec: WeaponSpec): Beam {
    this.muzzleOf(player, _origin)
    this.aimOf(player, _dir)

    // A completed lock bends the muzzle onto the target, so a locked rail shot
    // rewards the wind-up instead of still demanding pixel aim.
    if (spec.needsLock && player.lock.phase === 'locked') {
      const target = this.getPlayer(player.lock.targetId ?? '')
      if (target) {
        const t = target.chassis.translation()
        _dir.set(t.x - _origin.x, t.y + 0.5 - _origin.y, t.z - _origin.z).normalize()
      }
    }

    const range   = spec.range
    const blocker = this.staticBlockerAt(_origin, _dir, range)
    const reach   = Math.min(range, blocker)

    const struck = resolveBeamHits({
      origin:    _origin,
      direction: _dir,
      reach,
      radius:    this.config.hullRadius + (spec.beamWidth ?? 0.1),
      team:      player.team,
      pierce:    spec.pierce,
    }, this.hitCandidates())

    const end = struck.length && !spec.pierce ? struck[0].distance : reach

    const beam: Beam = {
      id:        this.shotSeq++,
      shooterId: player.id,
      team:      player.team,
      weapon:    spec.id,
      from:      [ _origin.x, _origin.y, _origin.z ],
      to:        [ _origin.x + _dir.x * end, _origin.y + _dir.y * end, _origin.z + _dir.z * end ],
      life:      spec.beamLife ?? 0.1,
      hit:       struck.length > 0,
    }

    // Kept locally so the sim can age it for its own debug views; the CLIENT
    // gets it on the fire event and ages its own copy. A beam lives about a
    // tenth of a second, so re-sending it in every snapshot at 30 Hz sent the
    // same segment three times and then stopped mattering.
    this.beams.push(beam)

    for (const { candidate } of struck) {
      const victim = this.getPlayer(candidate.id)
      if (victim)
        this.applyDamage(victim, player.id, spec.damage, spec.id)
    }

    return beam
  }

  /**
   * Build the salvo's spawn, add the missiles, and hand the spawn back so the
   * fire event can carry it.
   *
   * The fan itself lives in `projectiles.ts` because the CLIENT runs the same
   * function on the same event. Duplicating it here — even correctly — would
   * mean two copies that only diverge under fire, which is the worst possible
   * time to discover it.
   */
  private launchMissiles (player: BattlePlayer, spec: WeaponSpec): ProjectileSpawn {
    this.muzzleOf(player, _origin)
    this.aimOf(player, _dir)

    const spawn: ProjectileSpawn = {
      shooterId:  player.id,
      team:       player.team,
      weapon:     spec.id,
      firstId:    this.shotSeq,
      origin:     [ _origin.x, _origin.y, _origin.z ],
      dir:        [ _dir.x, _dir.y, _dir.z ],
      serverTick: this.tickNo,
      seed:       this.shotSeq,
      targetId:   player.lock.phase === 'locked' ? player.lock.targetId : null,
    }

    const salvo = spawnProjectiles(spawn)
    this.shotSeq += salvo.length
    this.missiles.push(...salvo)

    return spawn
  }

  private ageBeams (dt: number): void {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      this.beams[i].life -= dt
      if (this.beams[i].life <= 0)
        this.beams.splice(i, 1)
    }
  }

  /**
   * Fly the guided warheads.
   *
   * They travel at 255–300 u/s against a 55 u/s hull, so a missile crosses the
   * arena in about two seconds and cannot be outrun — dodging one means putting
   * a mesa between you and it, which the static raycast below honours.
   */
  private stepMissiles (dt: number): void {
    const { hullRadius } = this.config

    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m    = this.missiles[i]
      const spec = WEAPONS[m.weapon]
      m.life -= dt

      const target = m.targetId ? this.getPlayer(m.targetId) : null
      if (target)
        homeToward(m, target.chassis.translation(), spec, dt)

      const stepX   = m.velocity[0] * dt
      const stepY   = m.velocity[1] * dt
      const stepZ   = m.velocity[2] * dt
      const stepLen = Math.hypot(stepX, stepY, stepZ)

      // Sweep, don't teleport: at 300 u/s a missile covers 5 units per tick and
      // would tunnel straight through a mesa wall on a naive position add.
      let dead = m.life <= 0
      if (!dead && stepLen > 1e-5) {
        _origin.set(m.position[0], m.position[1], m.position[2])
        _dir.set(stepX / stepLen, stepY / stepLen, stepZ / stepLen)

        const blocker = this.staticBlockerAt(_origin, _dir, stepLen)
        if (blocker <= stepLen) {
          m.position[0] += _dir.x * blocker
          m.position[1] += _dir.y * blocker
          m.position[2] += _dir.z * blocker
          this.detonate(m, spec)
          dead = true
        }
        else {
          m.position[0] += stepX
          m.position[1] += stepY
          m.position[2] += stepZ
        }
      }

      if (!dead) {
        const reach = hullRadius + (spec.blastRadius ?? 4)
        for (const p of this.players) {
          if (p.team === m.team)
            continue

          const tt = p.chassis.translation()
          const dx = tt.x - m.position[0]
          const dy = tt.y + 0.5 - m.position[1]
          const dz = tt.z - m.position[2]
          if (dx * dx + dy * dy + dz * dz <= reach * reach) {
            this.detonate(m, spec)
            dead = true
            break
          }
        }
      }

      if (dead) {
        // A fuse that ran out never reaches `detonate`, so announce it here or
        // every client keeps flying a missile the server has forgotten.
        if (m.life <= 0)
          this.events.push({ type: 'detonate', id: m.id, x: m.position[0], y: m.position[1], z: m.position[2] })

        this.missiles.splice(i, 1)
      }
    }
  }

  /** Splash everything hostile inside the blast radius. */
  private detonate (m: Missile, spec: WeaponSpec): void {
    const reach  = this.config.hullRadius + (spec.blastRadius ?? 4)
    const centre = { x: m.position[0], y: m.position[1], z: m.position[2] }

    this.events.push({ type: 'detonate', id: m.id, x: centre.x, y: centre.y, z: centre.z })

    for (const candidate of resolveBlastHits(centre, reach, m.team, this.hitCandidates())) {
      const victim = this.getPlayer(candidate.id)
      if (victim)
        this.applyDamage(victim, m.shooterId, spec.damage, spec.id)
    }
  }

  private applyDamage (target: BattlePlayer, hitBy: string, damage: number, weapon: WeaponId): void {
    target.health = Math.max(0, target.health - damage)
    target.stun   = Math.max(target.stun, this.config.stunDuration)

    this.events.push({ type: 'hit', target: target.id, hitBy, weapon, damage })

    if (target.carriedFlag)
      this.dropFlag(target.carriedFlag, target)

    if (target.health <= 0)
      this.kill(target, hitBy, weapon)
  }

  private kill (target: BattlePlayer, hitBy: string, weapon: WeaponId | null): void {
    target.health = target.maxHealth
    target.respawnIndex++
    target.stun = 0
    target.lock = createLockState()

    registerKill(target, this.getPlayer(hitBy))

    this.events.push({ type: 'kill', target: target.id, hitBy, weapon })

    const pose = respawnPosition(this.arena, target.team, target.respawnIndex, SPAWN_LIFT)
    target.chassis.setTranslation(pose, true)
    target.chassis.setLinvel({ x: 0, y: 0, z: 0 }, true)
    target.chassis.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.returnCarriedFlag(target)
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

        // The one carrying an objective gets tagged; if neither carries, the
        // hit registers as contact only (ships already repel via rapier).
        const carrier = a.carriedFlag ? a : b.carriedFlag ? b : null
        if (carrier) {
          const by       = carrier === a ? b.id : a.id
          carrier.health = Math.max(0, carrier.health - 15)
          carrier.stun   = Math.max(carrier.stun, this.config.stunDuration)
          this.events.push({ type: 'tag', target: carrier.id, hitBy: by })
          if (carrier.carriedFlag)
            this.dropFlag(carrier.carriedFlag, carrier)
          if (carrier.health <= 0)
            this.kill(carrier, by, null)
        }
      }
    }
  }

  // --- control points -------------------------------------------------------

  /**
   * Domination rules and scoring, per zone.
   *
   * The capture meter itself is `zones.ts`'s `stepZone`; scoring only ticks for
   * a zone that STARTED this tick owned, which is why `startedOwned` is read
   * before `stepZone` runs — a zone that flips to owned mid-tick scores nothing
   * until the next one.
   */
  private stepZones (dt: number): void {
    const poses = this.players.map(p => {
      const t = p.chassis.translation()
      return { team: p.team, x: t.x, z: t.z }
    })

    for (const zone of this.zones) {
      const counts       = countOccupants(zone.def, poses)
      const startedOwned = zone.owner !== null

      const event = stepZone(zone, dt, counts, this.arena)
      if (event)
        this.events.push(event)

      if (!startedOwned)
        continue

      if (tickZoneScore(zone, dt, this.arena.zonePeriod, this.config, this.scores))
        this.endMatch()
    }
  }

  // --- objectives -----------------------------------------------------------

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
      flag.position = [ t.x, t.y + 1.8, t.z ]

      // Captured: enemy objective sitting on the carrier's OWN base scores.
      if (carrier.team !== flag.team) {
        const base = this.arena.bases[carrier.team].position
        if (distSq2D(t.x, t.z, base[0], base[2]) <= this.config.baseRadius * this.config.baseRadius) {
          const total         = scoreFlagCapture(this.scores, carrier.team, this.config.captureBonus)
          carrier.carriedFlag = null
          this.returnFlagHome(flag)
          this.events.push({ type: 'flagScored', team: flag.team, by: carrier.id, score: total })
          if (scoreTargetReached(this.scores, this.config))
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
    flag.position       = [ t.x, t.y + 0.9, t.z ]
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
          id:           p.id,
          team:         p.team,
          name:         p.name,
          shipId:       p.shipId,
          health:       p.health,
          maxHealth:    p.maxHealth,
          x:            t.x,
          y:            t.y,
          z:            t.z,
          qx:           q.x,
          qy:           q.y,
          qz:           q.z,
          qw:           q.w,
          boost:        p.boostMeter,
          stun:         p.stun,
          kills:        p.kills,
          deaths:       p.deaths,
          primaryCd:    p.cooldown.primary / WEAPONS[p.loadout.primary].cooldown,
          secondaryCd:  p.cooldown.secondary / WEAPONS[p.loadout.secondary].cooldown,
          lockPhase:    p.lock.phase,
          lockTarget:   p.lock.targetId,
          lockMeter:    p.lock.progress,
          aimAngle:     p.aimAngle,
          respawnIndex: p.respawnIndex,
        }
      }),
      zones: this.zones.map(z => ({
        id:        z.def.id,
        owner:     z.owner,
        progress:  z.progress,
        capturing: z.capturing,
        contested: z.contested,
      })),
      flags: this.flags.map(f => ({
        team:      f.team,
        state:     f.state,
        carrierId: f.carrierId,
        x:         f.position[0],
        y:         f.position[1],
        z:         f.position[2],
      })),
    }
  }
}
