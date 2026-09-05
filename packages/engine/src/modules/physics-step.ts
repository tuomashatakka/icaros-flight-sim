import { defineModule } from 'threejs-scene'
import type { AppModule } from 'threejs-scene'
import type { RaceState } from 'Ƨ'
import type { Physics } from 'Φworld'


/**
 * Advances the world and captures interpolation snapshots.
 *
 * Must be mounted AFTER every module that applies forces (module order is
 * update order) and BEFORE anything that reads the solved pose. Snapshots are
 * taken here and only here, immediately after the step, so `prev`/`curr` always
 * bracket exactly one step.
 */
export function physicsStepModule (physics: Physics): AppModule<RaceState> {
  const { world } = physics

  return defineModule<RaceState>({
    name: 'physics-step',

    build () {
      // The world already exists — it is created before createApp so module
      // build order can't leave anyone stepping a world that isn't there.
    },

    update () {
      // Stepped without the event queue: no scene has ever supplied a collision
      // handler, so draining it only ever built tuples for nobody. Impacts reach
      // the game through the sim, which is the half that is authoritative about
      // them anyway.
      world.step()

      for (const interpolator of physics.interpolators)
        interpolator.commit()
    },
  })
}
