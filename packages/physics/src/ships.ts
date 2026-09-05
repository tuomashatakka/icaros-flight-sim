/**
 * The hull roster, as identity only.
 *
 * The simulation needs to know WHICH ship a pilot is flying — it goes in a
 * snapshot, a wire schema validates it, and a match record stores it — but it
 * has no business knowing what the ship looks like. So the ids live down here
 * with the physics, and `src/lib/ship/registry.ts` hangs models, textures and
 * palettes off them.
 *
 * Typing that registry as `Record<ShipId, ShipPreset>` makes the two halves
 * impossible to drift: an id with no preset and a preset with no id are both
 * compile errors.
 */

export const SHIP_IDS = [ 'cb1', 'icaras', 'ag-systems', 'assegai', 'auricom', 'egx', 'feisar', 'harimau', 'qirex' ] as const

export type ShipId = typeof SHIP_IDS[number]

export const DEFAULT_SHIP_ID: ShipId = SHIP_IDS[0]

export function isShipId (value: unknown): value is ShipId {
  return typeof value === 'string' && (SHIP_IDS as readonly string[]).includes(value)
}
