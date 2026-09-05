import type { App } from 'threejs-scene'
import { gameplayStore, raceStore, shipStore, tuningStore } from 'Δstate'
import type { RaceState } from 'Δstate'
import { vehicleConfig } from '@/lib/utils'

/**
 * Mirrors the client stores into app state, one direction only.
 *
 * The stores keep owning the race status, ship config, and tuning; the engine
 * only ever *reads* those here. Engine outputs travel the other way through the
 * publish module, and the two sets of fields are disjoint, so there is no
 * feedback loop.
 *
 * @returns Detach function — wire it into the app's dispose chain, not a
 * separate React effect, or a subscription can outlive the app it writes to.
 */
export function attachBridge (app: App<RaceState>): () => void {
  const unsubscribers = [
    // Race status. The server owns the machine and the scene mirrors it in, but
    // the direction of flow here is unchanged: store out to app state, never
    // the reverse.
    raceStore.select(s => s.status, status => app.setState({ status }), { fireImmediately: true }),

    // Resolve zone -> target speed ONCE per zone change, so the sim never scans
    // the speedLevels array per tick.
    gameplayStore.select(s => s.zone, zone => {
      const levels = gameplayStore.get().speedLevels
      const level  = levels.find(l => l.zone === zone) ?? levels[levels.length - 1]
      app.setState({
        targetSpeed: Math.min(level?.speedTarget ?? vehicleConfig.maxSpeed, vehicleConfig.maxSpeed),
      })
    }, { fireImmediately: true }),

    // Ship customisation, for the livery/glow the visual module applies.
    shipStore.select(s => s.currentConfig, shipConfig => app.setState({ shipConfig }), { fireImmediately: true }),

    // Live physics tuning. Same one-way rule: the panel owns the numbers, the
    // vehicle module only reads them off state each tick.
    tuningStore.select(s => s.tuning, tuning => app.setState({ tuning }), { fireImmediately: true }),
  ]

  return () => {
    for (const unsubscribe of unsubscribers)
      unsubscribe()
  }
}
