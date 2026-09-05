/**
 * The hit geometry, as pure functions over supplied poses.
 *
 * Extracted from `BattleSim` for one reason that matters: lag compensation.
 * `fireBeam` and `detonate` used to read `chassis.translation()` directly, so
 * a shot could only ever resolve against where ships are NOW. The server needs
 * to resolve it against where the shooter SAW them — half a round trip ago —
 * and it cannot do that if the geometry is welded to live rapier bodies.
 *
 * Everything here is deliberately free of rapier, three and the sim: given
 * positions in, hits out. It is also the first time this math has been
 * testable on its own, which is worth something by itself — a ray-vs-sphere
 * test that is wrong by a sign is invisible in a running game and obvious in a
 * unit test.
 *
 * The vertical `+0.5` offsets that used to be scattered through the call sites
 * live here as `HULL_CENTRE_Y`: a chassis origin sits at the hull's floor, and
 * aiming at it rather than at the middle of the ship made beams pass under
 * targets that looked square in the reticle.
 */

import type { BattleTeam } from './arena'


/** Chassis origin to hull centre. Shots aim at the middle of a ship, not its floor. */
export const HULL_CENTRE_Y = 0.5

export type Vec3 = { x: number; y: number; z: number }

/** A ship a shot could touch, at the pose the shot should be resolved against. */
export type HitCandidate = {
  id:       string;
  team:     BattleTeam;
  position: Vec3;
}

export type BeamHit = {
  candidate: HitCandidate;

  /** Distance along the ray, so hits resolve nearest-first. */
  distance: number;
}

export type BeamQuery = {
  origin: Vec3;

  /** Must be unit length; the projection below assumes it. */
  direction: Vec3;

  /** Distance the beam actually travels — weapon range, or the arena if nearer. */
  reach: number;

  /** Hull radius plus the beam's own width. */
  radius: number;

  /** Team that fired. Friendly ships are never candidates. */
  team: BattleTeam;

  /** When false, only the nearest hit lands. */
  pierce?: boolean;
}

/**
 * Every enemy the beam touches, nearest first.
 *
 * Point-to-line distance rather than a rapier shapecast: ships are spheres for
 * combat purposes (`hullRadius`), and a real cast would also collide with the
 * arena, which `staticBlockerAt` has already accounted for by shortening
 * `reach`.
 */
export function resolveBeamHits (query: BeamQuery, candidates: readonly HitCandidate[]): BeamHit[] {
  const { origin, direction, reach, radius, team } = query
  const hits: BeamHit[]                            = []

  for (const candidate of candidates) {
    if (candidate.team === team)
      continue

    const dx = candidate.position.x - origin.x
    const dy = candidate.position.y + HULL_CENTRE_Y - origin.y
    const dz = candidate.position.z - origin.z

    // Projection onto the ray. Negative means the target is behind the muzzle.
    const along = dx * direction.x + dy * direction.y + dz * direction.z
    if (along < 0 || along > reach)
      continue

    const perpSq = dx * dx + dy * dy + dz * dz - along * along
    if (perpSq <= radius * radius)
      hits.push({ candidate, distance: along })
  }

  hits.sort((a, b) => a.distance - b.distance)
  return query.pierce ? hits : hits.slice(0, 1)
}

/** Everything hostile inside a blast sphere. Order is irrelevant — splash is not occluded. */
export function resolveBlastHits (
  centre: Vec3,
  reach: number,
  team: BattleTeam,
  candidates: readonly HitCandidate[]
): HitCandidate[] {
  const out: HitCandidate[] = []

  for (const candidate of candidates) {
    if (candidate.team === team)
      continue

    const dx = candidate.position.x - centre.x
    const dy = candidate.position.y + HULL_CENTRE_Y - centre.y
    const dz = candidate.position.z - centre.z

    if (dx * dx + dy * dy + dz * dz <= reach * reach)
      out.push(candidate)
  }

  return out
}
