import * as THREE from 'three'
import type RAPIER from '@dimforge/rapier3d-deterministic-compat'
import { defineModule } from 'threejs-scene'
import type { AppModule } from 'threejs-scene'
import { useRaceStore } from '@/hooks/use-race-store'
import type { Transform } from '@/hooks/use-race-store'
import type { RaceState } from '../state'
import type { Physics } from '@crash-velocity/physics/world'
import type { LevelSpec } from '../levels/types'


const WORLD_UP = new THREE.Vector3(0, 1, 0)

type Checkpoint = {
  index:     number;
  transform: Transform;
}

/**
 * Build one oriented gate per waypoint.
 *
 * Ported verbatim from the R3F `RaceManager`: gates are thin along travel and
 * tall/wide enough that the ship can't slip past, and crossing one in the
 * expected order advances the lap (the ordering rule lives in the race store).
 */
function buildCheckpoints (level: LevelSpec): Checkpoint[] {
  const { waypoints, loop } = level
  const n                   = waypoints.length

  return waypoints.map((p, i) => {
    const ahead  = waypoints[(i + 1) % n]
    const behind = waypoints[(i - 1 + n) % n]
    // Forward = direction of travel through this gate.
    const forward = ahead.clone().sub(loop ? p : behind)
      .normalize()
    if (forward.lengthSq() < 1e-6)
      forward.set(0, 0, -1)

    const right = new THREE.Vector3().crossVectors(WORLD_UP, forward)
      .normalize()
    if (right.lengthSq() < 1e-6)
      right.set(1, 0, 0)

    const up    = new THREE.Vector3().crossVectors(forward, right)
      .normalize()
    const basis = new THREE.Matrix4().makeBasis(right, up, forward)
    const quat  = new THREE.Quaternion().setFromRotationMatrix(basis)

    return {
      index:     i,
      transform: {
        position:   [ p.x, p.y + 1.5, p.z ],
        quaternion: [ quat.x, quat.y, quat.z, quat.w ],
      },
    }
  })
}

/**
 * Checkpoint gates and the race clock.
 *
 * Gate crossings arrive through rapier's `EventQueue` (drained by the
 * physics-step module) rather than R3F's `onIntersectionEnter` convenience, so
 * collider handles are mapped back to checkpoint indices here.
 */
export function raceModule (
  physics: Physics,
  level: LevelSpec,
  isVehicleCollider: (handle: number) => boolean
): AppModule<RaceState> & { handleCollision(a: number, b: number, started: boolean): void } {
  const { RAPIER, world } = physics
  const checkpoints       = buildCheckpoints(level)
  const gateByHandle      = new Map<number, Checkpoint>()
  let gateBody: RAPIER.RigidBody | null = null

  const module = defineModule<RaceState>({
    name: 'race',

    build () {
      gateBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())

      for (const cp of checkpoints) {
        const [ x, y, z ]        = cp.transform.position
        const [ qx, qy, qz, qw ] = cp.transform.quaternion

        const collider = world.createCollider(
          RAPIER.ColliderDesc.cuboid(level.width / 2 + 2, 4, 1.5)
            .setTranslation(x, y, z)
            .setRotation({ x: qx, y: qy, z: qz, w: qw })
            .setSensor(true)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
          gateBody
        )
        gateByHandle.set(collider.handle, cp)
      }

      useRaceStore.getState().configureRace({
        checkpointCount: checkpoints.length,
        laps:            level.laps,
        loop:            level.loop,
        spawn:           checkpoints[0]?.transform ?? {
          position:   [ 1, 2, 4 ],
          quaternion: [ 0, 1, 0, 0 ],
        },
      })
    },

    update (_state, frame) {
      // Sim time, not wall time: the clock already bounds advance by dropping
      // overflow, so a blurred tab can no longer fast-forward the countdown —
      // which is exactly what the old `Math.min(delta, 0.1)` clamp defended
      // against. The clamp is deliberately not ported.
      useRaceStore.getState().tick(frame.delta)
    },

    dispose () {
      if (gateBody) {
        world.removeRigidBody(gateBody)
        gateBody = null
      }
      gateByHandle.clear()
    },
  }) as AppModule<RaceState> & { handleCollision(a: number, b: number, started: boolean): void }

  module.handleCollision = (a, b, started) => {
    if (!started)
      return

    const gate = gateByHandle.get(a) ?? gateByHandle.get(b)
    if (!gate)
      return

    // The other half of the pair must be the ship, not scenery.
    const other = gateByHandle.has(a) ? b : a
    if (!isVehicleCollider(other))
      return

    useRaceStore.getState().passCheckpoint(gate.index, gate.transform)
  }

  return module
}
