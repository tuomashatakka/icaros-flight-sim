/**
 * Wire frame → sim input, shared by the server that applies a frame and the
 * client that replays it. See the note in battle's copy: the two halves
 * disagreeing about a bitfield is a desync nobody would look for.
 */

import { InputButton } from 'Ξ'

import type { InputFrame } from 'Ξ'
import type { RaceInput } from './types'


export function toRaceInput (frame: InputFrame): RaceInput {
  return {
    steer:    frame.steer,
    strafe:   frame.strafe,
    aimPitch: frame.pitch,
    throttle: frame.throttle > 0.5,
    brake:    frame.brake > 0.5,
    boost:    (frame.buttons & InputButton.BOOST) !== 0,
    reverse:  (frame.buttons & InputButton.REVERSE) !== 0,
    resetSeq: frame.resetSeq,
  }
}

export function fromRaceInput (input: RaceInput, clientTick: number): Omit<InputFrame, 'seq'> {
  return {
    clientTick,
    steer:    input.steer,
    pitch:    input.aimPitch,
    strafe:   input.strafe,
    throttle: input.throttle ? 1 : 0,
    brake:    input.brake ? 1 : 0,
    buttons:  (input.boost ? InputButton.BOOST : 0) | (input.reverse ? InputButton.REVERSE : 0),
    resetSeq: input.resetSeq,
  }
}
