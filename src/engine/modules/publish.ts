import { defineModule } from 'threejs-scene'
import type { AppModule } from 'threejs-scene'
import { useStore } from '@/hooks/use-store'
import type { RaceState } from '../state'
import type { Telemetry } from '../telemetry'

/** Store publish rate. Readouts do not need 60 Hz and React commits still cost. */
const PUBLISH_PERIOD = 1 / 15

/** Zone escalation interval, in SIM seconds (was a wall-clock setInterval). */
const ZONE_PERIOD = 10

/**
 * Mirrors simulation outputs to zustand for stores and non-engine consumers.
 *
 * The only engine -> `useStore` writer. Throttled, because the old code called
 * `setSpeed`/`setBoostMeter` every physics tick — 60 zustand writes a second,
 * each re-rendering the HUD tree.
 */
/**
 * Handle for restarting the throttles from a known state.
 *
 * Exists for the scenario runner: the zone accumulator advances on sim time
 * while racing, so a scripted run inherits however far into the current zone
 * period the live session happened to be — which makes a run that crosses a
 * zone boundary unreproducible.
 */
export type PublishHandle = { reset(): void }

type HandleType = { current: PublishHandle | null }

export function publishModule (
  telemetry: Telemetry,
  handle?: HandleType
): AppModule<RaceState> {
  let publishAccumulator = 0
  let zoneAccumulator    = 0
  let publishedCrashes   = 0
  let lastSpeed          = -1
  let lastBoost          = -1

  return defineModule<RaceState>({
    name: 'publish',

    build () {
      publishedCrashes = telemetry.crashSeq
      if (handle)
        handle.current = {
          reset () {
            publishAccumulator = 0
            zoneAccumulator    = 0
            publishedCrashes   = telemetry.crashSeq
            lastSpeed          = -1
            lastBoost          = -1
          },
        }
    },

    update (state, frame) {
      // Zone escalation on the sim clock: gated on actually racing, and it can
      // no longer tick in a hidden tab the way the old setInterval did.
      if (state.status === 'racing') {
        zoneAccumulator += frame.delta
        if (zoneAccumulator >= ZONE_PERIOD) {
          zoneAccumulator -= ZONE_PERIOD
          useStore.getState().increaseZone()
        }
      }

      // Crashes are edge events — flush every unseen increment, whatever the
      // publish cadence, so a flash is never dropped.
      while (publishedCrashes < telemetry.crashSeq) {
        useStore.getState().triggerCrash()
        publishedCrashes++
      }

      publishAccumulator += frame.delta
      if (publishAccumulator < PUBLISH_PERIOD)
        return
      publishAccumulator = 0

      const store = useStore.getState()
      if (Math.abs(telemetry.speed - lastSpeed) > 0.05) {
        lastSpeed = telemetry.speed
        store.setSpeed(telemetry.speed)
      }
      if (Math.abs(telemetry.boostMeter - lastBoost) > 0.01) {
        lastBoost = telemetry.boostMeter
        store.setBoostMeter(telemetry.boostMeter)
      }
    },
  })
}
