import type RAPIER from '@dimforge/rapier3d-compat'
import { defineModule } from 'threejs-scene'
import type { AppModule } from 'threejs-scene'
import { useRaceStore } from '@/hooks/use-race-store'
import type { Transform } from '@/hooks/use-race-store'
import type { RaceState } from '../state'
import type { Physics } from '../physics/world'
import { BodyInterpolator } from '../interpolation'
import { stepHovercraft, createHovercraft, createHovercraftState } from '@crash-velocity/physics/vehicle-step'
import type { HovercraftState, HovercraftStepResult } from '@crash-velocity/physics/vehicle-step'
import { MAIN_THRUST_CAPACITY } from '@crash-velocity/physics/thrusters'
import { vehicleConfig } from '@crash-velocity/physics/config'
import type { ForceSample } from '@crash-velocity/physics/thrusters'
import type { Telemetry } from '../telemetry'


/** Per-tick blend for the g meter. ~0.35 s to settle at 60 Hz. */
const G_SMOOTHING = 0.05

export type VehicleDebug = {
  racing:       boolean;
  engineForce:  number;
  currentSpeed: number;
  targetSpeed:  number;
  contacts:     number;
  dt:           number;

  /** Every force applied on the last tick, world space. Dev builds only. */
  forces:    readonly ForceSample[];
  netForce:  readonly [number, number, number];
  netTorque: readonly [number, number, number];
}

/**
 * Force collection allocates a sample per nozzle per tick, so it is gated on the
 * same flag that keeps the whole dev harness out of the production bundle.
 */
const COLLECT_FORCES = process.env.NODE_ENV !== 'production'

export type VehicleHandle = {
  readonly body:         RAPIER.RigidBody | null;
  readonly interpolator: BodyInterpolator | null;
  readonly debug:        VehicleDebug | null;

  /** Cut the ship to a transform. Suppresses interpolation across the jump. */
  teleportTo(transform: Transform, liftY?: number): void;
}

/**
 * The hovercraft.
 *
 * A rapier raycast-vehicle controller repurposed as a hover + grip engine:
 * long suspension rest length is the float height, wheel ray contacts are
 * ground-follow, and side friction is the carve that resists sliding out of a
 * turn. Steering is a SINGLE driven yaw about the ship's own up, and
 * orientation aligns ship-up to the averaged surface normal, so the ship banks
 * into banked corners and self-rights on flat ground.
 *
 * Ported from the R3F `useBeforePhysicsStep` body with the logic unchanged —
 * only how it obtains `dt`, state and input differs. The per-tick math itself
 * lives in `stepHovercraft` (shared with the headless battle server); this
 * module is the race-scene wrapper: it owns the Rapier body, the telemetry
 * writes and the interpolation/camera side effects that a headless host has no
 * use for.
 */
type HandleType = { current: VehicleHandle | null }

export function vehicleModule (
  physics: Physics,
  telemetry: Telemetry,
  handle: HandleType,
  onSnap: () => void
): AppModule<RaceState> {
  const { world } = physics

  let chassis: RAPIER.RigidBody | null      = null
  let interpolator: BodyInterpolator | null = null

  const simState: HovercraftState = createHovercraftState()

  let lastResetSeq                    = 0
  let lastStatus: RaceState['status'] = 'idle'
  let lastDebug: VehicleDebug | null  = null

  function teleportTo (transform: Transform, liftY = 1) {
    if (!chassis)
      return

    const { position, quaternion } = transform
    chassis.setTranslation({ x: position[0], y: position[1] + liftY, z: position[2] }, true)
    chassis.setRotation(
      { x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3] },
      true
    )
    chassis.setLinvel({ x: 0, y: 0, z: 0 }, true)
    chassis.setAngvel({ x: 0, y: 0, z: 0 }, true)
    simState.smoothedYawRate = 0
    telemetry.shake          = 0
    interpolator?.teleport()
    onSnap()
  }

  const respawn = () => teleportTo(useRaceStore.getState().respawn)

  return defineModule<RaceState>({
    name: 'vehicle',

    build () {
      chassis = createHovercraft(world).chassis

      interpolator = new BodyInterpolator(chassis)
      physics.interpolators.push(interpolator)

      handle.current = {
        get body () {
          return chassis
        },
        get interpolator () {
          return interpolator
        },
        get debug () {
          return lastDebug
        },
        teleportTo,
      }
    },

    update (state, frame) {
      if (!chassis)
        return

      const dt = frame.delta

      // Snap to the start line whenever a countdown begins (initial race +
      // "Race again"). Edge-triggered on the status transition.
      if (state.status === 'countdown' && lastStatus !== 'countdown') {
        teleportTo(useRaceStore.getState().spawn)
        telemetry.boostMeter = 1
      }
      lastStatus = state.status

      // Counter, not a boolean: the sim runs several ticks per real frame, so a
      // held key read as a level would respawn on every one of them.
      let resetRequested = false
      if (state.resetSeq !== lastResetSeq) {
        lastResetSeq = state.resetSeq
        resetRequested = true
      }

      const racing = state.status === 'racing'

      const result = stepHovercraft({
        chassis,
        world,
        input: {
          steer:    state.steer,
          throttle: state.throttle,
          brake:    state.brake,
          strafe:   state.strafe,
          boost:    state.boost,
        },
        tuning:        state.tuning,
        state:         simState,
        dt,
        allowDrive:    racing,
        spawn:         useRaceStore.getState().respawn,
        resetRequested,
        boostMeter:    telemetry.boostMeter,
        targetSpeed:   state.targetSpeed,
        collectForces: COLLECT_FORCES,
      })

      writeTelemetry(result)
      lastDebug = {
        racing,
        engineForce:  result.engineForce,
        currentSpeed: result.speed,
        targetSpeed:  state.targetSpeed,
        contacts:     result.contacts,
        dt,
        forces:       result.forces,
        netForce:     result.netForce,
        netTorque:    result.netTorque,
      }
    },

    dispose () {
      if (interpolator) {
        const index = physics.interpolators.indexOf(interpolator)
        if (index >= 0)
          physics.interpolators.splice(index, 1)
        interpolator = null
      }
      if (chassis) {
        world.removeRigidBody(chassis)
        chassis = null
      }
      handle.current = null
    },
  })

  function writeTelemetry (result: HovercraftStepResult) {
    telemetry.speed         = result.speed
    telemetry.boostMeter    = result.boostMeter
    telemetry.grounded      = result.grounded
    telemetry.airbrake      = result.airbrake
    telemetry.boosting      = result.boosting
    telemetry.thrustCommand = Math.min(1, result.engineForce / MAIN_THRUST_CAPACITY)

    // Applied force over weight — the load the airframe is actually carrying,
    // which is the number a g meter shows. Smoothed because a contact impulse
    // spikes it for one tick and an unfiltered needle reads as noise.
    const [ fx, fy, fz ] = result.netForce
    const g              = Math.hypot(fx, fy, fz) / (vehicleConfig.mass * 9.81)
    telemetry.gLoad     += (g - telemetry.gLoad) * G_SMOOTHING

    if (result.crashDelta > 0) {
      telemetry.crashSeq++
      telemetry.shake = result.shake
    }

    // A teleport zeroes the shake (the old teleportTo did the same) and cuts
    // interpolation across the jump.
    if (result.respawned) {
      telemetry.shake = 0
      interpolator?.teleport()
      onSnap()
    }
  }
}
