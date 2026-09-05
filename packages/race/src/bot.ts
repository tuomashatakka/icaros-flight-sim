/**
 * A drone that drives the racing line.
 *
 * Deliberately simple and deliberately deterministic: it reads the next gate,
 * turns toward it, and lifts off the throttle when the turn is sharp. Anything
 * cleverer would need `Math.random` or a wall clock, and both would break the
 * replay hash that proves the whole simulation is reproducible.
 *
 * Bots exist so a lobby of one is still a race, not to be competitive.
 */

import { Vector3 } from 'three'

import type { RaceSim, Racer } from './sim'
import type { RaceInput } from './types'


/** Beyond this angle off the nose, lift and turn rather than power through. */
const SHARP = 0.45

/** Below this, the line is straight enough to hold boost. */
const STRAIGHT = 0.12

const _target  = new Vector3()
const _heading = new Vector3()
const _toGate  = new Vector3()

export function raceBotInput (sim: RaceSim, racer: Racer, dt: number): RaceInput {
  const controls = racer.controls

  if (racer.progress.finished)
    return { ...controls, throttle: false, brake: true, boost: false, steer: 0, strafe: 0 }

  sim.aimAt(racer, _target)
  sim.headingOf(racer, _heading)

  const t = racer.chassis.translation()
  _toGate.set(_target.x - t.x, 0, _target.z - t.z)

  if (_toGate.lengthSq() < 1e-4)
    return controls

  _toGate.normalize()
  _heading.y = 0
  _heading.normalize()

  // Signed angle about +Y. Cross-product y-component gives the side; the dot
  // gives how far round. Together they are the steering error.
  const cross = _heading.x * _toGate.z - _heading.z * _toGate.x
  const dot   = Math.max(-1, Math.min(1, _heading.dot(_toGate)))
  const error = Math.atan2(cross, dot)
  const sharp = Math.abs(error)

  // +Y rotation is a LEFT turn and `steer` is negated exactly once, inside the
  //  vehicle — so the sign here matches what a human's key would produce.
  const steer = Math.max(-1, Math.min(1, -error * 1.6))

  void dt
  return {
    steer,
    strafe:   0,
    throttle: sharp < SHARP,
    brake:    sharp > SHARP * 2,
    boost:    sharp < STRAIGHT && racer.boostMeter > 0.3,
    reverse:  false,
    aimPitch: 0,
    resetSeq: controls.resetSeq,
  }
}
