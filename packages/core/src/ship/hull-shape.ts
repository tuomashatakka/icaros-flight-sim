/**
 * The parametric hull, as data.
 *
 * Fifteen numbers that reshape any of the nine hulls. They live in `core`
 * rather than beside the deformer because three packages need them and only
 * one of those may touch three.js: `Ȼ` declares the shape, `Σ` deforms vertices
 * with it, `Ʊ` renders a slider per entry, and `Ƨ` persists the result. A field
 * added here appears in all four without a second table to keep in step.
 *
 * Every value is a multiplier or an offset against a landmark MEASURED off the
 * hull at load time (`Σship/hull-profile`), never an absolute world distance —
 * which is what lets one set of ranges read sensibly on a stubby Feisar and on
 * a long Qirex alike.
 */

export type HullShape = {
  bodyWidth:    number;
  bodyHeight:   number;
  bodyLength:   number;
  noseSharp:    number;
  tailTaper:    number;
  wingSpan:     number;
  wingSweep:    number;
  wingDihedral: number;
  canopyRise:   number;
  podRadius:    number;
  podLength:    number;
  keelDepth:    number;
  spineArch:    number;
  chineFlare:   number;
  hullTwist:    number;
}

/**
 * The identity silhouette.
 *
 * At exactly these values the deformer restores the source mesh verbatim,
 * authored normals included, so "reset" is the model as its author exported it
 * rather than a re-derivation that quietly rounds off every hard edge.
 */
export const HULL_DEFAULTS: HullShape = {
  bodyWidth:    1,
  bodyHeight:   1,
  bodyLength:   1,
  noseSharp:    1,
  tailTaper:    1,
  wingSpan:     1,
  wingSweep:    0,
  wingDihedral: 0,
  canopyRise:   1,
  podRadius:    1,
  podLength:    1,
  keelDepth:    1,
  spineArch:    0,
  chineFlare:   0,
  hullTwist:    0,
}

export const HULL_SHAPE_KEYS = Object.keys(HULL_DEFAULTS) as (keyof HullShape)[]

/** Which panel group a parameter belongs to, so the hangar can lay itself out. */
export type HullGroup = 'proportion' | 'planform' | 'section'

export type HullSlider = {
  key:   keyof HullShape;
  label: string;
  group: HullGroup;
  min:   number;
  max:   number;
  step:  number;

  /** Suffix the hangar appends to the readout. */
  unit: '×' | '°' | '';

  /** Sampling window for "randomize build". Narrower than the slider range on purpose. */
  random: [number, number];
}

/**
 * One row per parameter, in the order a hull is built up: gross proportions,
 * then the plan-view features, then the section.
 *
 * The hangar renders this table rather than fifteen hand-written slider
 * elements — the previous three-slider version spelled each one out, and adding
 * a fourth meant editing markup in two places and a randomiser in a third.
 */
export const HULL_SLIDERS: HullSlider[] = [
  { key: 'bodyWidth', label: 'beam', group: 'proportion', min: 0.55, max: 1.8, step: 0.01, unit: '×', random: [ 0.75, 1.45 ]},
  { key: 'bodyHeight', label: 'profile', group: 'proportion', min: 0.45, max: 1.9, step: 0.01, unit: '×', random: [ 0.7, 1.4 ]},
  { key: 'bodyLength', label: 'length', group: 'proportion', min: 0.55, max: 1.8, step: 0.01, unit: '×', random: [ 0.75, 1.45 ]},
  { key: 'noseSharp', label: 'nose sharpness', group: 'planform', min: 0.3, max: 2.0, step: 0.01, unit: '×', random: [ 0.6, 1.6 ]},
  { key: 'tailTaper', label: 'tail taper', group: 'planform', min: 0.3, max: 2.0, step: 0.01, unit: '×', random: [ 0.6, 1.6 ]},
  { key: 'wingSpan', label: 'wing span', group: 'planform', min: 0.4, max: 2.2, step: 0.01, unit: '×', random: [ 0.7, 1.7 ]},
  { key: 'wingSweep', label: 'wing sweep', group: 'planform', min: -45, max: 60, step: 1, unit: '°', random: [ -20, 40 ]},
  { key: 'wingDihedral', label: 'wing dihedral', group: 'planform', min: -35, max: 35, step: 1, unit: '°', random: [ -18, 22 ]},
  { key: 'chineFlare', label: 'chine flare', group: 'planform', min: -0.6, max: 1.2, step: 0.01, unit: '', random: [ -0.25, 0.6 ]},
  { key: 'canopyRise', label: 'canopy rise', group: 'section', min: 0.2, max: 2.4, step: 0.01, unit: '×', random: [ 0.6, 1.8 ]},
  { key: 'keelDepth', label: 'keel depth', group: 'section', min: 0.2, max: 2.2, step: 0.01, unit: '×', random: [ 0.6, 1.6 ]},
  { key: 'podRadius', label: 'engine girth', group: 'section', min: 0.35, max: 2.2, step: 0.01, unit: '×', random: [ 0.7, 1.6 ]},
  { key: 'podLength', label: 'engine overhang', group: 'section', min: 0.35, max: 2.2, step: 0.01, unit: '×', random: [ 0.7, 1.6 ]},
  { key: 'spineArch', label: 'spine arch', group: 'section', min: -0.8, max: 1.2, step: 0.01, unit: '', random: [ -0.35, 0.6 ]},
  { key: 'hullTwist', label: 'hull twist', group: 'section', min: -30, max: 30, step: 1, unit: '°', random: [ -12, 12 ]},
]

export const HULL_GROUP_LABELS: Record<HullGroup, string> = {
  proportion: 'Proportions',
  planform:   'Planform',
  section:    'Section',
}

/** Pull just the shape fields out of a wider config object, filling gaps from factory. */
export function hullShapeOf (source: Partial<HullShape>): HullShape {
  const shape = { ...HULL_DEFAULTS }
  for (const key of HULL_SHAPE_KEYS) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value))
      shape[key] = value
  }
  return shape
}

/** Stable string for dirty-checking. Fifteen sliders is too many to compare by hand. */
export function hullShapeKey (shape: HullShape): string {
  return HULL_SHAPE_KEYS.map(key => shape[key]).join('|')
}

/** Is this the factory silhouette, to within float noise? */
export function isFactoryShape (shape: HullShape): boolean {
  return HULL_SHAPE_KEYS.every(key => Math.abs(shape[key] - HULL_DEFAULTS[key]) < 1e-6)
}
