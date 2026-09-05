/**
 * Rapier reproduces itself, bit for bit.
 *
 * The architecture document is explicit that this is the check to run BEFORE
 * relying on determinism for projectiles: the vendor's cross-platform claim
 * holds only for the enhanced-determinism build, at an identical version, and
 * only for identical construction and step order. So the claim is tested rather
 * than trusted.
 *
 * One naming trap worth recording: the document cites `world.createSnapshot()`,
 * which is the name in Rapier's RUST docs. The JavaScript binding calls it
 * `takeSnapshot()`, and reaching for the documented name gets you
 * `undefined is not a function`.
 *
 * This is not the same guarantee the scenario harnesses give. Those hash a
 * pose trace and prove the SIM is reproducible; this hashes the physics
 * engine's own serialised world and proves the layer underneath them is.
 */

import { describe, expect, it } from 'vitest'

import { initRapier } from 'Φrapier'
import { STEP } from 'Φclock'

import type { Rapier } from 'Φrapier'


/** FNV-1a over the serialised world. Any difference at all changes it. */
function hash (bytes: Uint8Array): string {
  let h = 0x811c9dc5
  for (const byte of bytes) {
    h ^= byte
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * A deliberately awkward world: bodies that collide with each other and with
 * the floor, at offsets that are not round numbers.
 *
 * A single body falling in a vacuum is reproducible on any build; what the
 * document's caveat is about is the contact solver, so the test has to reach it.
 */
type RunReturnType = { hash: string; y: number }

function run (RAPIER: Rapier, ticks: number): RunReturnType {
  const world    = new RAPIER.World({ x: 0, y: -9.81, z: 0 })
  world.timestep = STEP

  world.createCollider(RAPIER.ColliderDesc.cuboid(60, 0.5, 60).setTranslation(0, -0.5, 0))

  const bodies = []
  for (let i = 0; i < 8; i++) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(i * 0.37 - 1.3, 2 + i * 1.1, i * -0.21)
        .setLinvel(0.3 * i, 0, -0.17 * i)
    )
    world.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.225, 2.65), body)
    bodies.push(body)
  }

  for (let i = 0; i < ticks; i++)
    world.step()

  const snapshot = world.takeSnapshot()
  const result   = { hash: hash(snapshot), y: bodies[0].translation().y }

  world.free()
  return result
}

describe('rapier determinism', () => {
  it('produces an identical world snapshot from identical inputs', async () => {
    const RAPIER = await initRapier()

    const a = run(RAPIER, 600)
    const b = run(RAPIER, 600)

    expect(a.hash).toBe(b.hash)
    expect(a.y).toBe(b.y)
  }, 60_000)

  it('diverges when the inputs differ, so the hash is actually measuring something', async () => {
    const RAPIER = await initRapier()

    // A test that only ever asserts equality passes just as well against a
    // constant. One extra tick has to move it.
    expect(run(RAPIER, 600).hash).not.toBe(run(RAPIER, 601).hash)
  }, 60_000)

  it('is the enhanced-determinism build, not the SIMD one', async () => {
    // The SIMD build is explicitly NOT cross-platform deterministic. Nothing
    // above would notice the swap — it would keep passing on one machine and
    // desync between two — so the dependency itself is asserted.
    const { default: pkg } = await import('../../../package.json')
    const deps             = pkg.dependencies as Record<string, string>

    expect(deps['@dimforge/rapier3d-deterministic-compat']).toBeDefined()
    expect(deps['@dimforge/rapier3d-compat']).toBeUndefined()

    // Pinned exactly: determinism is only guaranteed for one version, so a
    // caret here would let a patch release desync a live match.
    expect(deps['@dimforge/rapier3d-deterministic-compat']).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
