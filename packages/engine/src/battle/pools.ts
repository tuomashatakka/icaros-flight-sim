import * as THREE from 'three'
import { WEAPONS } from 'Ψweapons'

import { buildBeamPool, buildExplosionPool, buildMissilePool } from './visuals'

import type { ExplosionPool } from './visuals'
import type { BattleFrame } from './transport'
import type { ProjectileField } from './projectiles'


/** Beams and missiles both cap out well under these; the pools never grow. */
export const BEAM_POOL    = 48
export const MISSILE_POOL = 64

// Smaller than the beam pool on purpose: bursts last under a second, so even a
// four-on-four scrap never has more than a handful alive at once.
export const BLAST_POOL   = 24

export type BattlePools = {

  /**
   * Hit and kill bursts.
   *
   * Exposed directly rather than folded into `step`: `battle.ts` spawns one
   * per hit/kill event, and ages it every frame whether or not a snapshot has
   * arrived yet — the scene always ran the burst clock that way, independent
   * of the beam/missile draw below.
   */
  blast: ExplosionPool;

  /** Draw every beam and missile in `snapshot`/`projectiles` for this frame. */
  step(snapshot: BattleFrame, projectiles: ProjectileField): void;
  dispose(): void;
}

// Reused so the per-frame draw stays allocation-free.
const missilePosition = { x: 0, y: 0, z: 0 }
const missileVelocity = { x: 0, y: 0, z: 0 }
const beamFrom        = { x: 0, y: 0, z: 0 }
const beamTo          = { x: 0, y: 0, z: 0 }

/**
 * Build the beam, missile and blast pools and mount them into `scene`.
 *
 * A fixed ring of meshes reused in order, built once and never grown — a busy
 * fight cannot stutter on a GC the way per-shot allocation would.
 */
export function createBattlePools (scene: THREE.Scene): BattlePools {
  const beam    = buildBeamPool(BEAM_POOL)
  const missile = buildMissilePool(MISSILE_POOL)
  const blast   = buildExplosionPool(BLAST_POOL)

  scene.add(beam.group, missile.group, blast.group)

  return {
    blast,

    step (snapshot, projectiles) {
      // Beams are sub-100 ms flashes, drawn from the newest snapshot rather
      // than interpolated: one smoothed into the past would arrive after the
      // impact it belongs to.
      for (let i = 0; i < snapshot.beams.length; i++) {
        const b    = snapshot.beams[i]
        const spec = WEAPONS[b.weapon]
        beamFrom.x = b.from[0]
        beamFrom.y = b.from[1]
        beamFrom.z = b.from[2]
        beamTo.x   = b.to[0]
        beamTo.y   = b.to[1]
        beamTo.z   = b.to[2]
        // Fade over the beam's remaining life so a hit reads as a flash, not a
        // rod that blinks out.
        beam.show(i, beamFrom, beamTo,
                  b.weapon, Math.max(0, Math.min(1, b.life / (spec.beamLife ?? 0.1))))
      }
      beam.hideFrom(snapshot.beams.length)

      // Missiles are NOT in the snapshot any more — they are spawned from a
      // fire event and integrated locally, so this draws whatever the field
      // stepped this frame rather than dead-reckoning from a packet that is
      // already old.
      for (let i = 0; i < projectiles.count; i++) {
        const m           = projectiles.at(i)!
        missilePosition.x = m.position[0]
        missilePosition.y = m.position[1]
        missilePosition.z = m.position[2]
        missileVelocity.x = m.velocity[0]
        missileVelocity.y = m.velocity[1]
        missileVelocity.z = m.velocity[2]
        missile.show(i,
                     missilePosition,
                     missileVelocity,
                     m.weapon)
      }
      missile.hideFrom(projectiles.count)
    },

    dispose () {
      beam.dispose()
      missile.dispose()
      blast.dispose()
    },
  }
}
