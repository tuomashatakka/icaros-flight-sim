/**
 * Turning floats into the fewest bits that still look right.
 *
 * Orientation is the dominant per-entity cost in a flight sim — a ship's
 * position changes slowly and predictably, its attitude does not — so that is
 * where the compression pays for itself. A raw quaternion is 128 bits; the
 * smallest-three encoding below is 32, and the error it introduces is smaller
 * than one screen pixel of rotation at arena distances.
 */

/** Clamp then round to `bits` of unsigned range across `[min, max]`. */
export function quantize (value: number, min: number, max: number, bits: number): number {
  const steps  = (1 << bits) - 1
  const span   = max - min
  const scaled = span === 0 ? 0 : (value - min) / span * steps
  return Math.max(0, Math.min(steps, Math.round(scaled))) >>> 0
}

export function dequantize (raw: number, min: number, max: number, bits: number): number {
  const steps = (1 << bits) - 1
  return steps === 0 ? min : min + raw / steps * (max - min)
}

/**
 * The largest a non-largest component of a unit quaternion can be.
 *
 * If three components exceeded 1/√2 the fourth would have to be imaginary, so
 * this is the exact bound and the three encoded components can use all of it.
 */
export const SMALLEST_THREE_BOUND = Math.SQRT1_2

// Bits per stored component. Fiedler measured 9 as sufficient; 10 is free here
//  because it lands the whole encoding on exactly 32 bits with the 2-bit index.
export const QUAT_COMPONENT_BITS = 10

export type Quat = { x: number; y: number; z: number; w: number }

/**
 * Smallest-three: drop the largest component and send the other three plus a
 * 2-bit index saying which one is missing.
 *
 * The dropped component is recovered as `sqrt(1 − a² − b² − c²)`, which is only
 * unambiguous if its sign is known — so the whole quaternion is negated when
 * the largest component is negative. `q` and `−q` are the same rotation, so
 * nothing is lost by that.
 */
export function packQuaternion (q: Quat): number {
  const components = [ q.x, q.y, q.z, q.w ]

  let largest = 0
  for (let i = 1; i < 4; i++)
    if (Math.abs(components[i]) > Math.abs(components[largest]))
      largest = i

  const sign = components[largest] < 0 ? -1 : 1

  let packed = largest >>> 0
  let shift  = 2

  for (let i = 0; i < 4; i++) {
    if (i === largest)
      continue

    const value = quantize(components[i] * sign, -SMALLEST_THREE_BOUND, SMALLEST_THREE_BOUND, QUAT_COMPONENT_BITS)
    packed += value * 2 ** shift
    shift  += QUAT_COMPONENT_BITS
  }

  return packed
}

export function unpackQuaternion (packed: number, out: Quat = { x: 0, y: 0, z: 0, w: 1 }): Quat {
  const largest = packed % 4
  let rest      = Math.floor(packed / 4)

  const values: number[] = [ 0, 0, 0, 0 ]
  const mask             = (1 << QUAT_COMPONENT_BITS) - 1
  let sumOfSquares       = 0

  for (let i = 0; i < 4; i++) {
    if (i === largest)
      continue

    const value = dequantize(rest & mask, -SMALLEST_THREE_BOUND, SMALLEST_THREE_BOUND, QUAT_COMPONENT_BITS)
    values[i]   = value
    sumOfSquares += value * value
    rest = Math.floor(rest / (mask + 1))
  }

  // Rounding can push the sum a hair past 1; clamping keeps the sqrt real
  // rather than producing a NaN quaternion that silently blanks a ship.
  values[largest] = Math.sqrt(Math.max(0, 1 - sumOfSquares))

  out.x = values[0]
  out.y = values[1]
  out.z = values[2]
  out.w = values[3]
  return out
}

/** Total bits `packQuaternion` occupies: 2 for the index, three components. */
export const QUAT_BITS = 2 + 3 * QUAT_COMPONENT_BITS
