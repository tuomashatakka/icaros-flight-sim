import { DEFAULT_TUNING, type ShipTuning } from '@/engine/state';

/**
 * Pure helpers behind the tuning panel's footer buttons.
 *
 * Kept out of the store module so they can be tested without instantiating
 * zustand's persist middleware — the logic here has nothing to do with storage.
 */

/** Whether the live values still match the factory defaults. */
export function isDefaultTuning(tuning: ShipTuning): boolean {
  return (Object.keys(DEFAULT_TUNING) as Array<keyof ShipTuning>).every(
    (key) => tuning[key] === DEFAULT_TUNING[key]
  );
}

/**
 * The current tuning as a pasteable `vehicleConfig` fragment.
 *
 * Deliberately emits only the fields that MOVED. A full dump invites pasting
 * seven lines over `src/lib/utils.ts` when one of them changed, silently
 * reverting anyone else's edits to the other six.
 */
export function asSource(tuning: ShipTuning): string {
  const changed = (Object.keys(DEFAULT_TUNING) as Array<keyof ShipTuning>).filter(
    (key) => tuning[key] !== DEFAULT_TUNING[key]
  );
  if (!changed.length) return '// tuning matches vehicleConfig — nothing to copy';
  return [
    '// paste into `vehicleConfig` in src/lib/utils.ts',
    ...changed.map((key) => `${key}: ${tuning[key]},`),
  ].join('\n');
}
