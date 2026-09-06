import { SHIP_IDS } from 'Φships'
import type { ShipId } from 'Φships'
// Single source of truth for every selectable ship.
//
// Adding a ship = one entry in SHIP_PRESETS. Everything downstream derives from
// it: the ShipId union, the persisted store's per-ship configs, the hangar
// selection buttons, and the runtime loader dispatch in ship-visual.tsx.
//
// This module holds ONLY plain data + types (no three.js import) so it can be
// pulled into the zustand store, React components, and the material layer alike
// without dragging WebGL code where it doesn't belong.

import type { WeaponId } from 'Ψweapons'
import { HULL_DEFAULTS } from './hull-shape'
import type { HullShape } from './hull-shape'


export type TexturePreset = 'plain' | 'panels' | 'carbon' | 'hazard' | 'city' | 'gallery' | 'racing' | 'splinter' | 'circuit'
export type PaletteName =
  | 'default' | 'colibri' | 'ion' | 'ember' | 'ink' | 'toxic' |
  'mercury' | 'venom' | 'sunset' | 'abyss' | 'bone' | 'vapor'

/**
 * The user-tweakable fields (everything in a config except which ship it is).
 *
 * Extends `HullShape`, so the fifteen parametric-geometry sliders are part of a
 * ship config by construction: adding one to `hull-shape.ts` makes it
 * persisted, randomisable and deformable without touching this file.
 */
export interface ShipCustomization extends HullShape {
  bodyColor:         string;
  emissiveColor:     string;
  metalness:         number;
  roughness:         number;
  emissiveIntensity: number;
  texturePreset:     TexturePreset;
  textureRepeat:     number;
  paletteName:       PaletteName;

  /**
   * Afterburner plume colour.
   *
   * Deliberately separate from `emissiveColor`: on the WipEout hulls that field
   * modulates a BAKED livery map and its factory value is black, so driving the
   * plume from it would leave seven of nine ships with no visible exhaust.
   */
  burnColor: string;

  /** Afterburner beam brightness. 0 switches the plume off entirely. */
  burnIntensity: number;

  /** Afterburner beam length, as a multiple of the derived nozzle radius. */
  burnLength: number;

  /**
   * Multiplier on the DETECTED pod separation: 1 means "where the tail geometry
   * says the engines are", 0 collapses both beams onto the centreline. The
   * detection is a heuristic over a scanned mesh, so it stays correctable.
   */
  nozzleSpread: number;

  // --- livery, second layer -------------------------------------------------

  /**
   * Accent colour for stripes, panel edges and canopy tint.
   *
   * Separate from `emissiveColor` because that one drives the GLOW bucket on
   * the baked-livery hulls and is black by default there; a trim colour has to
   * be visible on all nine.
   */
  trimColor: string;

  /**
   * Gloss, 0..1.
   *
   * Driven into `envMapIntensity`, not a clearcoat lobe: the hulls are
   * `MeshStandardMaterial` and swapping nine of them to `MeshPhysicalMaterial`
   * to gain one slider costs a full shader recompile per ship. Against the
   * hangar's PMREM environment the reflective response is what "gloss" means
   * to the eye anyway.
   */
  gloss: number;

  /** Rotates the generated pattern, so stripes need not run along the hull axis. */
  patternAngle: number;

  // --- hull shape -----------------------------------------------------------
  //
  // The fifteen geometry parameters come in through `HullShape`. They are a
  // real VERTEX deform against landmarks scanned off the hull at load time, not
  // a scale on the fit group — which is what the first three used to be, and
  // why they could only ever stretch a silhouette rather than reshape one.

  /** Normal-map depth, i.e. how pronounced the hull plating reads. */
  platingDepth: number;

  // --- armament -------------------------------------------------------------

  /** Beam-class weapon on the primary trigger. */
  primaryWeapon: WeaponId;

  /** Missile-class weapon on the secondary trigger. Requires a lock to fire. */
  secondaryWeapon: WeaponId;

  /** Barrel size multiplier on the derived hardpoints. */
  gunScale: number;

  /** Multiplier on the hull half-width when placing the two hardpoints. */
  gunSpread: number;

  /** Hide the bolt-on barrels entirely (some hulls read better clean). */
  gunsVisible: boolean;
}

/** Per-ship handling bias. Carried as metadata only — not wired into physics (yet). */
export interface ShipStats {
  topSpeed:   number;
  accel:      number;
  handling:   number;
  durability: number;
}

interface ShipPresetCommon {

  /** Short internal display name. */
  name: string;

  /** Hangar button label. */
  label: string;

  /** Hangar button sub-label. */
  description: string;

  /** Local-space rotation to bring the authored model's nose to +z (travel dir). */
  modelRotation: [number, number, number];

  /** Overrides applied over BASE_CONFIG to produce this ship's factory defaults. */
  defaults: Partial<ShipCustomization>;
  stats:    ShipStats;
}

export type ShipPreset =
  | ShipPresetCommon & { kind: 'gltf'; path: string } |
  ShipPresetCommon & { kind: 'generated' } |
  ShipPresetCommon & {
    kind: 'fbx';

    /** FBX mesh under /public. */
    path: string;

    /** Folder holding body/cockpit/glass/glow/glow_e.jpg livery for this ship. */
    textureBase: string;

    /** WipEout scans already read nose +z; kept for the odd model that needs a 180° flip. */
    noseFlip: boolean;
  }

const STOCK_STATS: ShipStats = { topSpeed: 1, accel: 1, handling: 1, durability: 1 }

/**
 * Shared factory appearance for the 7 WipEout FBX ships. They carry a baked team livery, so
 * applyShipConfig() only modulates these on top of it — texturePreset/textureRepeat are
 * deliberately inert for them (see materials.ts). Without real defaults here the sliders
 * would snap the whole fleet to BASE_CONFIG grey the moment they went live.
 */
const WIPEOUT_LOOK: Partial<ShipCustomization> = {
  metalness:         0.45,
  roughness:         0.52,
  emissiveIntensity: 0.65, // x3 in the glow branch, matching the authored 1.9
  texturePreset:     'plain',
  textureRepeat:     1,
}

/**
 * Every hull's appearance, keyed by the roster in `@crash-velocity/physics`.
 *
 * The `Record<ShipId, …>` annotation is the point: the simulation owns the id
 * list, and a preset that names an unknown ship — or a ship with no preset —
 * fails to compile rather than showing up as an invisible hull.
 */
export const SHIP_PRESETS: Record<ShipId, ShipPreset> = {
  'cb1': {
    kind:          'gltf',
    path:          '/spaceship_-_cb1/scene.gltf',
    name:          'CB1',
    label:         'CB1',
    description:   'Standard racer',
    modelRotation: [ 0, -Math.PI / 2, 0 ],
    defaults:      { burnColor: '#36d6ff' },
    stats:         STOCK_STATS,
  },
  'icaras': {
    kind:          'generated',
    name:          'Icaras',
    label:         'Icaras',
    description:   'Aerodynamic design',
    // Nose points along +z (travel direction); no 180° flip or it drives in reverse.
    modelRotation: [ 0, 0, 0 ],
    defaults:      {
      burnColor:         '#7a5cff',
      bodyColor:         '#4a90e2',
      emissiveColor:     '#ff00ff',
      metalness:         0.3,
      roughness:         0.4,
      emissiveIntensity: 0.5,
      texturePreset:     'panels',
      textureRepeat:     2,
      paletteName:       'colibri',
    },
    stats: STOCK_STATS,
  },
  'ag-systems': {
    kind:          'fbx',
    path:          '/ships/ag-systems/ag-systems.fbx',
    textureBase:   '/ships/ag-systems',
    noseFlip:      false,
    name:          'AG-Systems',
    label:         'AG-Systems',
    description:   'Nimble all-rounder',
    modelRotation: [ 0, 0, 0 ],
    defaults:      { ...WIPEOUT_LOOK, burnColor: '#36d6ff' },
    stats:         { topSpeed: 1.05, accel: 1.0, handling: 1.05, durability: 0.95 },
  },
  'assegai': {
    kind:          'fbx',
    path:          '/ships/assegai/assegai.fbx',
    textureBase:   '/ships/assegai',
    noseFlip:      false,
    name:          'Assegai',
    label:         'Assegai',
    description:   'Quick off the line',
    modelRotation: [ 0, 0, 0 ],
    defaults:      { ...WIPEOUT_LOOK, burnColor: '#ffb52f' },
    stats:         { topSpeed: 1.0, accel: 1.1, handling: 1.05, durability: 0.9 },
  },
  'auricom': {
    kind:          'fbx',
    path:          '/ships/auricom/auricom.fbx',
    textureBase:   '/ships/auricom',
    noseFlip:      false,
    name:          'Auricom',
    label:         'Auricom',
    description:   'Tanky & grippy',
    modelRotation: [ 0, 0, 0 ],
    defaults:      { ...WIPEOUT_LOOK, burnColor: '#ff4a3a' },
    stats:         { topSpeed: 0.95, accel: 1.0, handling: 1.1, durability: 1.1 },
  },
  'egx': {
    kind:          'fbx',
    path:          '/ships/egx/egx.fbx',
    textureBase:   '/ships/egx',
    noseFlip:      false,
    name:          'EG-X',
    label:         'EG-X',
    description:   'Top-speed bruiser',
    modelRotation: [ 0, 0, 0 ],
    defaults:      { ...WIPEOUT_LOOK, burnColor: '#caff2f' },
    stats:         { topSpeed: 1.1, accel: 0.95, handling: 0.9, durability: 1.0 },
  },
  'feisar': {
    kind:          'fbx',
    path:          '/ships/feisar/feisar.fbx',
    textureBase:   '/ships/feisar',
    noseFlip:      false,
    name:          'Feisar',
    label:         'Feisar',
    description:   'Best handling',
    modelRotation: [ 0, 0, 0 ],
    defaults:      { ...WIPEOUT_LOOK, burnColor: '#ffd23f' },
    stats:         { topSpeed: 1.0, accel: 1.0, handling: 1.15, durability: 1.0 },
  },
  'harimau': {
    kind:          'fbx',
    path:          '/ships/harimau/harimau.fbx',
    textureBase:   '/ships/harimau',
    noseFlip:      false,
    name:          'Harimau',
    label:         'Harimau',
    description:   'Durable heavyweight',
    modelRotation: [ 0, 0, 0 ],
    defaults:      { ...WIPEOUT_LOOK, burnColor: '#ffcf2f' },
    stats:         { topSpeed: 0.9, accel: 1.05, handling: 1.0, durability: 1.2 },
  },
  'qirex': {
    kind:          'fbx',
    path:          '/ships/qirex/qirex.fbx',
    textureBase:   '/ships/qirex',
    noseFlip:      false,
    name:          'Qirex',
    label:         'Qirex',
    description:   'Fastest, twitchy',
    modelRotation: [ 0, 0, 0 ],
    defaults:      { ...WIPEOUT_LOOK, burnColor: '#ff3fd8' },
    stats:         { topSpeed: 1.15, accel: 0.9, handling: 0.95, durability: 0.95 },
  },
} satisfies Record<string, ShipPreset>

export { SHIP_IDS }
export type { ShipId }

export interface ShipConfig extends ShipCustomization {
  shipId: ShipId;
}

/** Neutral appearance every ship starts from before its preset `defaults` are folded in. */
export const BASE_CONFIG: ShipCustomization = {
  bodyColor:         '#ffffff',
  emissiveColor:     '#000000',
  metalness:         0.5,
  roughness:         0.5,
  emissiveIntensity: 0.0,
  texturePreset:     'plain',
  textureRepeat:     1,
  paletteName:       'default',
  burnColor:         '#7a5cff',
  burnIntensity:     1,
  burnLength:        1,
  nozzleSpread:      1,
  trimColor:         '#36d6ff',
  gloss:             0.9,
  patternAngle:      0,
  ...HULL_DEFAULTS,
  platingDepth:      1,
  primaryWeapon:     'pulse',
  secondaryWeapon:   'hornet',
  gunScale:          0.85,
  gunSpread:         1,
  gunsVisible:       true,
}

export function buildDefaultConfig (shipId: ShipId): ShipConfig {
  return { ...BASE_CONFIG, ...SHIP_PRESETS[shipId].defaults, shipId }
}

/** Factory defaults per ship, kept separate so "Reset" restores them even after edits. */
export const DEFAULT_CONFIGS = Object.fromEntries(
  SHIP_IDS.map(id => [ id, buildDefaultConfig(id) ])
) as Record<ShipId, ShipConfig>
