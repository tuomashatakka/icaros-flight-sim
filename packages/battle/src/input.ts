/**
 * Wire frame → sim input.
 *
 * Shared by the server that APPLIES a frame and the client that REPLAYS it
 * during reconciliation, and it has to be: if the two disagreed about what
 * `buttons & 2` means, prediction would diverge on exactly the ticks where a
 * player was shooting, which is the worst possible time to find out.
 */

import { InputButton } from '@crash-velocity/net'

import type { InputFrame } from '@crash-velocity/net'
import type { BattleInput } from './types'


export function toBattleInput (frame: InputFrame): BattleInput {
  return {
    steer:         frame.steer,
    strafe:        frame.strafe,
    aimPitch:      frame.pitch,
    throttle:      frame.throttle > 0.5,
    brake:         frame.brake > 0.5,
    boost:         (frame.buttons & InputButton.BOOST) !== 0,
    fire:          (frame.buttons & InputButton.FIRE) !== 0,
    fireSecondary: (frame.buttons & InputButton.SECONDARY) !== 0,
    reverse:       (frame.buttons & InputButton.REVERSE) !== 0,
    resetSeq:      frame.resetSeq,
  }
}

/** The inverse, for the client's input pump. */
export function fromBattleInput (input: BattleInput, clientTick: number): Omit<InputFrame, 'seq'> {
  return {
    clientTick,
    steer:    input.steer,
    pitch:    input.aimPitch ?? 0,
    strafe:   input.strafe ?? 0,
    throttle: input.throttle ? 1 : 0,
    brake:    input.brake ? 1 : 0,
    buttons:
      (input.boost ? InputButton.BOOST : 0) |
      (input.fire ? InputButton.FIRE : 0) |
      (input.fireSecondary ? InputButton.SECONDARY : 0) |
      (input.reverse ? InputButton.REVERSE : 0),
    resetSeq: input.resetSeq,
  }
}
