/**
 * The prop catalogue.
 *
 * Lives in `core` because four packages need it and only one of them may touch
 * three.js: the forge authors placements, the compiler turns the solid ones into
 * colliders, the engine builds the geometry, and the UI lists them in a palette.
 * So this declares WHAT a prop is and how big it is, and nothing about how it
 * looks — exactly the split `Ȼship/hull-shape` uses for hulls.
 *
 * Every entry is procedural. Nothing here loads a mesh, because a track editor
 * that needs an asset pipeline before it can place a barrier is an editor
 * nobody uses.
 */

import type { BoxCollider } from 'Φcolliders'


export type PropCategory = 'structure' | 'hazard' | 'dressing'

export type PropDef = {
  kind:     PropKind;
  name:     string;
  category: PropCategory;

  /**
   * Half-extents of the collider, world metres, before the placement's scale.
   *
   * `null` for a prop you drive straight through — a banner, a hologram, a
   * light. A prop with a collider is a prop that can end a lap, so this is
   * stated per entry rather than inferred from the geometry.
   */
  half: readonly [number, number, number] | null;

  /** Nominal drawn height, so a palette can preview them at a sane scale. */
  height: number;

  /** Default accent. A placement may override it. */
  color: string;
}

export type PropKind =
  | 'pylon' |
  'archway' |
  'gantry' |
  'tower' |
  'billboard' |
  'barrier-block' |
  'tyre-stack' |
  'chicane-cone' |
  'jump-ramp' |
  'boost-pad' |
  'spike-strip' |
  'crate-stack' |
  'antenna-mast' |
  'satellite-dish' |
  'light-mast' |
  'holo-sign' |
  'banner-flag' |
  'pipe-run' |
  'fan-vent' |
  'beacon' |
  'rock-spire' |
  'wreck-hulk'

/**
 * One placed prop, as authored.
 *
 * Plain JSON with no `Vector3` on it, for the same reason the rest of the
 * document is: it is exported, imported, undone and put in React state as the
 * same value.
 */
export type PropPlacement = {
  id:   string;
  kind: PropKind;
  x:    number;
  y:    number;
  z:    number;

  /** Facing, degrees about +y. */
  yaw:   number;
  scale: number;

  /** Overrides `PropDef.color` when set. */
  color?: string;
}

export const PROP_CATALOGUE: Record<PropKind, PropDef> = {
  // --- structure ----------------------------------------------------------
  'pylon':     { kind: 'pylon', name: 'Pylon', category: 'structure', half: [ 1.2, 9, 1.2 ], height: 18, color: '#6b7ba8' },
  'archway':   { kind: 'archway', name: 'Archway', category: 'structure', half: [ 14, 9, 1.4 ], height: 18, color: '#8a9bff' },
  'gantry':    { kind: 'gantry', name: 'Gantry', category: 'structure', half: [ 16, 1.2, 2 ], height: 14, color: '#7d8aa8' },
  'tower':     { kind: 'tower', name: 'Comms tower', category: 'structure', half: [ 3.5, 22, 3.5 ], height: 44, color: '#5d6a8c' },
  'billboard': { kind: 'billboard', name: 'Billboard', category: 'structure', half: [ 9, 5, 0.6 ], height: 16, color: '#22d3ee' },
  'pipe-run':  { kind: 'pipe-run', name: 'Pipe run', category: 'structure', half: [ 12, 1.6, 1.6 ], height: 4, color: '#8b93a8' },

  // --- hazard -------------------------------------------------------------
  'barrier-block': { kind: 'barrier-block', name: 'Barrier block', category: 'hazard', half: [ 3, 1.4, 1 ], height: 3, color: '#ffd06a' },
  'tyre-stack':    { kind: 'tyre-stack', name: 'Tyre stack', category: 'hazard', half: [ 1.6, 1.6, 1.6 ], height: 3.2, color: '#2c2c34' },
  'chicane-cone':  { kind: 'chicane-cone', name: 'Chicane cone', category: 'hazard', half: [ 0.7, 1.1, 0.7 ], height: 2.2, color: '#ff8a3d' },
  'jump-ramp':     { kind: 'jump-ramp', name: 'Jump ramp', category: 'hazard', half: [ 7, 1.8, 9 ], height: 4, color: '#4a5170' },
  'boost-pad':     { kind: 'boost-pad', name: 'Boost pad', category: 'hazard', half: null, height: 0.3, color: '#7fffd1' },
  'spike-strip':   { kind: 'spike-strip', name: 'Spike strip', category: 'hazard', half: [ 5, 0.6, 1 ], height: 1.4, color: '#ff5470' },
  'rock-spire':    { kind: 'rock-spire', name: 'Rock spire', category: 'hazard', half: [ 4, 11, 4 ], height: 22, color: '#4a4238' },
  'wreck-hulk':    { kind: 'wreck-hulk', name: 'Wreck hulk', category: 'hazard', half: [ 5, 2.4, 9 ], height: 5, color: '#3a3f4d' },

  // --- dressing -----------------------------------------------------------
  'crate-stack':    { kind: 'crate-stack', name: 'Crate stack', category: 'dressing', half: [ 2.2, 2.2, 2.2 ], height: 4.4, color: '#7a6a4a' },
  'antenna-mast':   { kind: 'antenna-mast', name: 'Antenna mast', category: 'dressing', half: null, height: 26, color: '#9aa4bd' },
  'satellite-dish': { kind: 'satellite-dish', name: 'Satellite dish', category: 'dressing', half: [ 4, 4, 4 ], height: 9, color: '#b9c2d6' },
  'light-mast':     { kind: 'light-mast', name: 'Light mast', category: 'dressing', half: null, height: 20, color: '#fff3c4' },
  'holo-sign':      { kind: 'holo-sign', name: 'Holo sign', category: 'dressing', half: null, height: 10, color: '#ff78bd' },
  'banner-flag':    { kind: 'banner-flag', name: 'Banner', category: 'dressing', half: null, height: 12, color: '#b892ff' },
  'fan-vent':       { kind: 'fan-vent', name: 'Fan vent', category: 'dressing', half: [ 3.4, 0.8, 3.4 ], height: 1.6, color: '#5a6274' },
  'beacon':         { kind: 'beacon', name: 'Beacon', category: 'dressing', half: null, height: 6, color: '#ff5470' },
}

export const PROP_KINDS = Object.keys(PROP_CATALOGUE) as PropKind[]

export function isPropKind (value: unknown): value is PropKind {
  return typeof value === 'string' && value in PROP_CATALOGUE
}

/** Props of one category, in catalogue order. For the palette. */
export function propsByCategory (category: PropCategory): PropDef[] {
  return PROP_KINDS.map(kind => PROP_CATALOGUE[kind]).filter(def => def.category === category)
}

/**
 * The colliders a set of placements implies.
 *
 * Here rather than beside the geometry, because the server never draws a prop
 * and still has to simulate one. A prop with `half: null` — a banner, a
 * hologram, a boost pad — contributes nothing: you drive through it.
 *
 * The box is axis-aligned about the placement's own yaw, which is what
 * `BoxCollider.rotation` carries, so a rotated archway blocks the road it is
 * rotated across rather than the one it was authored on.
 */
export function propColliders (placements: readonly PropPlacement[]): BoxCollider[] {
  const boxes: BoxCollider[] = []

  for (const placement of placements) {
    const def = PROP_CATALOGUE[placement.kind]
    if (!def?.half)
      continue

    const scale          = placement.scale || 1
    const [ hx, hy, hz ] = def.half

    boxes.push({
      // Lifted by its own half-height: a placement's `y` is where the prop
      // STANDS, which is the bottom of the geometry, and a collider is centred.
      position: [ placement.x, placement.y + hy * scale, placement.z ],
      rotation: [ 0, placement.yaw * Math.PI / 180, 0 ],
      args:     [ hx * scale, hy * scale, hz * scale ],
    })
  }

  return boxes
}
