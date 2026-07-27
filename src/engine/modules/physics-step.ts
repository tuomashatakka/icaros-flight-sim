import { defineModule } from 'threejs-scene'
import type { AppModule } from 'threejs-scene'
import type { RaceState } from '../state'
import type { Physics } from '../physics/world'


export type CollisionHandler = (handleA: number, handleB: number, started: boolean) => void

/**
 * Advances the world and captures interpolation snapshots.
 *
 * Must be mounted AFTER every module that applies forces (module order is
 * update order) and BEFORE anything that reads the solved pose. Snapshots are
 * taken here and only here, immediately after the step, so `prev`/`curr` always
 * bracket exactly one step.
 */
export function physicsStepModule (
  physics: Physics,
  onCollision?: CollisionHandler
): AppModule<RaceState> {
  const { world, eventQueue } = physics

  return defineModule<RaceState>({
    name: 'physics-step',

    build () {
      // The world already exists — it is created before createApp so module
      // build order can't leave anyone stepping a world that isn't there.
    },

    update () {
      world.step(eventQueue)

      if (onCollision)
        eventQueue.drainCollisionEvents((handleA, handleB, started) => {
          onCollision(handleA, handleB, started)
        })

      for (const interpolator of physics.interpolators)
        interpolator.commit()
    },
  })
}
