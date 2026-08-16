import type { App } from 'threejs-scene'
import { raceModule } from '../modules/race'
import { hudModule } from '../hud'
import { initialRaceState } from '../state'
import type { RaceState } from '../state'
import { flatsLevel } from '../levels/flats'
import { neonCanyonLevel } from '../levels/neon-canyon'
import { orbitalRingLevel } from '../levels/orbital-ring'
import { proceduralLevel } from '../levels/procedural'
import type { LevelId, LevelSpec } from '../levels/types'
import { mountBaseScene } from './base'


const LEVEL_BUILDERS: Record<LevelId, () => LevelSpec> = {
  'flats':        flatsLevel,
  'neon-canyon':  neonCanyonLevel,
  'orbital-ring': orbitalRingLevel,
  'procedural':   proceduralLevel,
}

/**
 * The race scene composition root.
 *
 * Uses `mountBaseScene` as its base and attaches race-specific level geometry,
 * colliders, race logic, and HUD.
 */
export async function mountRace (
  canvas: HTMLCanvasElement,
  levelId: LevelId
): Promise<App<RaceState>> {
  const builder = LEVEL_BUILDERS[levelId] ?? flatsLevel
  const level   = builder()

  return mountBaseScene<RaceState>({
    canvas,
    levelId,
    levelSpec:      level,
    initialState:   initialRaceState(),
    background:     level.background,
    bloom:          level.bloom,
    colliders:      level.colliders,
    colliderOffset: level.colliderOffset,
    buildGeometry:  (ctx, physics) => {
      level.build(ctx, physics)
    },
    gameModuleFactory: (physics, isVehicleCollider) => {
      const race = raceModule(physics, level, isVehicleCollider)
      return {
        module:          race,
        handleCollision: race.handleCollision,
      }
    },
    hudModuleFactory: (shipRoot, telemetry, hudRef) => hudModule(shipRoot, level, telemetry, hudRef),
  })
}
