import type { App } from 'threejs-scene'
import { useRaceStore } from '@/hooks/use-race-store'
import { useStore } from '@/hooks/use-store'
import { useShipStore } from '@/hooks/use-ship-store'
import { useTuningStore } from '@/hooks/use-tuning-store'
import { vehicleConfig } from '@/lib/utils'
import type { RaceState } from './state'

/**
 * Mirrors zustand into app state, one direction only.
 *
 * Zustand keeps owning the race state machine, ship config, and tuning; the
 * engine only ever *reads* those here. Engine outputs travel the other way
 * through the publish module, and the two sets of fields are disjoint, so there
 * is no feedback loop.
 *
 * @returns Detach function — wire it into the app's dispose chain, not a
 * separate React effect, or a subscription can outlive the app it writes to.
 */
export function attachBridge (app: App<RaceState>): () => void {
  const unsubscribers: Array<() => void> = []

  // Race status: the store owns the machine, the engine reads the result.
  unsubscribers.push(
    useRaceStore.subscribe(
      s => s.status,
      status => app.setState({ status }),
      { fireImmediately: true }
    )
  )

  // Resolve zone -> target speed ONCE per zone change, so the sim never scans
  // the speedLevels array per tick the way the R3F vehicle did.
  unsubscribers.push(
    useStore.subscribe(
      s => s.zone,
      zone => {
        const levels = useStore.getState().speedLevels
        const level  = levels.find(l => l.zone === zone) ?? levels[levels.length - 1]
        app.setState({
          targetSpeed: Math.min(level?.speedTarget ?? vehicleConfig.maxSpeed, vehicleConfig.maxSpeed),
        })
      },
      { fireImmediately: true }
    )
  )

  // Ship customisation, for the livery/glow the visual module applies.
  unsubscribers.push(
    useShipStore.subscribe(
      s => s.currentConfig,
      shipConfig => app.setState({ shipConfig }),
      { fireImmediately: true }
    )
  )

  // Live physics tuning. Same one-way rule as everything else here: the panel
  // owns the numbers, the vehicle module only reads them off state each tick.
  unsubscribers.push(
    useTuningStore.subscribe(
      s => s.tuning,
      tuning => app.setState({ tuning }),
      { fireImmediately: true }
    )
  )

  return () => {
    for (const unsubscribe of unsubscribers)
      unsubscribe()
  }
}
