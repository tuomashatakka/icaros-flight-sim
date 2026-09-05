/**
 * Lock-on: acquisition, holding and breaking, plus the cone/visibility test
 * both the lock and `hasLineOfSight` need.
 *
 * Extracted from `BattleSim.stepLock`/`bestLockCandidate`, which between them
 * carried a complexity of 23. `scanForLock` and `isVisible` reuse `aim.ts`'s
 * `castArenaRay` and `hitscan.ts`'s `HitCandidate`/`HULL_CENTRE_Y` rather than
 * re-deriving either — an aim/hit split that already existed once is not worth
 * re-litigating here.
 *
 * `advanceLock` is a pure state machine over the `LockState` record: given
 * this tick's scan and a way to resolve who a target id currently is, it
 * decides whether the lock fills, holds, slips or breaks, and returns the
 * `lock` event on the tick it completes. It does not resolve player ids
 * itself — only `BattleSim` has a roster to look one up in — which is also
 * why it takes a lookup function rather than a `Map` snapshot: a lock can
 * reassign `lock.targetId` mid-call, and the lookup has to see that.
 */

import { Vector3 } from 'three'
import { castArenaRay } from './aim'
import { HULL_CENTRE_Y } from './hitscan'
import { LOCK } from './weapons'

import type RAPIER from '@dimforge/rapier3d-deterministic-compat'
import type { BattleTeam } from './arena'
import type { HitCandidate, Vec3 } from './hitscan'
import type { LockState } from './weapons'
import type { BattleEvent } from './types'


// Scratch, module scope: lock scanning runs once per player per tick, and one
// sim runs one world at a time, so these are reused rather than allocated.
const _from = new Vector3()
const _dir  = new Vector3()

export type LockScan = {
  targetId: string | null;
  cos:      number;
  visible:  boolean;
}

/**
 * The enemy nearest the crosshair: smallest angular error, then distance.
 *
 * Visibility is computed only for the current best candidate, and only when
 * it improves on the previous best — a raycast per player per tick was the
 * actual cost here, not the trig.
 */
export function scanForLock (
  world:       RAPIER.World,
  ray:         RAPIER.Ray,
  origin:      Vec3,
  aimDir:      Vec3,
  shooterId:   string,
  shooterTeam: BattleTeam,
  candidates:  readonly HitCandidate[]
): LockScan {
  let targetId: string | null = null
  let cos                     = -1
  let visible                 = false

  _from.set(origin.x, origin.y, origin.z)

  for (const other of candidates) {
    if (other.team === shooterTeam || other.id === shooterId)
      continue

    const dx = other.position.x - origin.x
    const dy = other.position.y + HULL_CENTRE_Y - origin.y
    const dz = other.position.z - origin.z

    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (dist > LOCK.range || dist < 1e-3)
      continue

    const inv = 1 / dist
    const ux  = dx * inv
    const uy  = dy * inv
    const uz  = dz * inv

    const candidateCos = aimDir.x * ux + aimDir.y * uy + aimDir.z * uz
    if (candidateCos < LOCK.holdCos || candidateCos <= cos)
      continue

    cos      = candidateCos
    targetId = other.id
    _dir.set(ux, uy, uz)
    visible  = castArenaRay(world, ray, _from, _dir, dist) >= dist
  }

  return { targetId, cos, visible }
}

/** True when nothing solid stands between two points. Shared by weapons and the lock. */
export function isVisible (world: RAPIER.World, ray: RAPIER.Ray, from: Vec3, to: Vec3): boolean {
  const dx = to.x - from.x
  const dy = to.y + HULL_CENTRE_Y - from.y
  const dz = to.z - from.z

  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
  if (dist < 1e-3)
    return true

  const inv = 1 / dist
  _from.set(from.x, from.y, from.z)
  _dir.set(dx * inv, dy * inv, dz * inv)
  return castArenaRay(world, ray, _from, _dir, dist) >= dist
}

/** Who a lock currently points at, as much as `advanceLock` needs to know. */
export type LockTargetLookup = (id: string) => { id: string; team: BattleTeam } | undefined

type LockIdentity = { id: string; team: BattleTeam }

/**
 * Decide who the lock should point at this tick, and settle `lock.targetId`.
 *
 * Switching targets is a hard reset: a lock is earned per target, and carrying
 * progress across would let a player sweep the crosshair over a crowd and snap
 * onto whoever happened to be last — so a completed lock (`phase === 'locked'`)
 * is sticky against a new best candidate; only an untargeted or still-tracking
 * lock snaps to one. Returns null (having already reset the meter to idle)
 * when there is nothing valid to point at — no candidate, or the looked-up
 * target turned out to be on the shooter's own team.
 */
function resolveTarget (
  lock:        LockState,
  scan:        LockScan,
  shooterTeam: BattleTeam,
  getTarget:   LockTargetLookup
): LockIdentity | null {
  if (scan.targetId && lock.targetId !== scan.targetId && lock.phase !== 'locked') {
    lock.targetId = scan.targetId
    lock.progress = 0
    lock.slip     = 0
  }

  const current = lock.targetId ? getTarget(lock.targetId) : undefined
  if (current && current.team !== shooterTeam)
    return current

  lock.targetId = scan.targetId
  lock.progress = 0
  lock.phase    = 'idle'
  lock.slip     = 0
  return null
}

/**
 * Fill, hold or bleed the meter, depending on where the crosshair sits
 * relative to the two cones. Returns whether the target is currently inside
 * the wider hold ring, which the caller still needs for the keep-locked grace.
 */
function updateMeter (lock: LockState, dt: number, onTarget: boolean, scan: LockScan): boolean {
  const inAcquire = onTarget && scan.cos >= LOCK.acquireCos && scan.visible
  const inHold    = onTarget && scan.cos >= LOCK.holdCos && scan.visible

  if (inAcquire) {
    lock.slip     = 0
    lock.progress = Math.min(1, lock.progress + dt / LOCK.time)
  }
  else {
    lock.slip += dt
    if (lock.slip > LOCK.slipGrace && !inHold)
      lock.progress = Math.max(0, lock.progress - dt * LOCK.decay)
  }

  return inHold
}

/**
 * Advance one lock by one tick.
 *
 * Two cones, not one: `scan` only fills the meter from inside `LOCK.acquireCos`,
 * while the wider `holdCos` ring merely stalls a fill in progress instead of
 * collapsing it. Returns the `lock` event on the tick the meter fills, null
 * every other tick.
 */
export function advanceLock (
  lock:        LockState,
  dt:          number,
  live:        boolean,
  shooterId:   string,
  shooterTeam: BattleTeam,
  scan:        LockScan,
  getTarget:   LockTargetLookup
): BattleEvent | null {
  if (!live) {
    lock.targetId = null
    lock.progress = 0
    lock.phase    = 'idle'
    lock.slip     = 0
    return null
  }

  const current = resolveTarget(lock, scan, shooterTeam, getTarget)
  if (!current)
    return null

  const inHold = updateMeter(lock, dt, scan.targetId === current.id, scan)

  let event: BattleEvent | null = null

  if (lock.progress >= 1) {
    if (lock.phase !== 'locked') {
      lock.phase = 'locked'
      event      = { type: 'lock', id: shooterId, target: current.id }
    }
    // A finished lock only breaks after the target has been off-cone for
    // longer than the grace window.
    if (!inHold && lock.slip > LOCK.keepLocked) {
      lock.progress = 0
      lock.phase    = 'tracking'
    }
  }
  else
    lock.phase = lock.progress > 0 ? 'tracking' : 'idle'

  return event
}
