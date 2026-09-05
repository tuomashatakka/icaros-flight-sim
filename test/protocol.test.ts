/**
 * The wire protocol is the one contract the client and the server cannot
 * negotiate at runtime, so it is pinned here rather than discovered in a match.
 *
 * The hostile-input cases are not paranoia for its own sake: the previous
 * transport fed `JSON.parse` output straight into the sim, so anything a socket
 * could say, a match had to survive.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_INPUT_FRAMES,
  PROTOCOL_VERSION,
  jsonCodec,
  parseClientMessage,
  toBattleInput,
} from 'Δengine/battle/protocol'
import type { InputFrame, InputPacket, JoinRequest, ServerMessage } from 'Δengine/battle/protocol'


const frame = (seq: number): InputFrame => ({
  seq,
  clientTick:    seq,
  steer:         0.5,
  throttle:      true,
  brake:         false,
  boost:         false,
  fire:          true,
  fireSecondary: false,
  reverse:       false,
  strafe:        0,
  aimPitch:      0.25,
  resetSeq:      0,
})

const encoded = (message: object) => jsonCodec.encode(message as ServerMessage)

describe('codec', () => {
  it('round-trips every client message shape', () => {
    const messages = [
      { type: 'join', protocol: PROTOCOL_VERSION, name: 'Pilot', shipId: 'icaras' },
      { type: 'input', frames: [ frame(1), frame(2) ], lastAckSnapshot: 10, interpTick: 8 },
      { type: 'leave' },
      { type: 'ping', t0: 1234.5 },
      { type: 'dev', cmd: 'face', x: 10, z: -20 },
    ]

    for (const message of messages) {
      const result = parseClientMessage(encoded(message))
      expect(result.ok, `${message.type} should parse`).toBe(true)
      if (result.ok)
        expect(result.message).toMatchObject(message)
    }
  })

  it('decodes binary frames as well as text', () => {
    const bytes  = new TextEncoder().encode(encoded({ type: 'ping', t0: 7 }))
    const result = parseClientMessage(bytes)
    expect(result.ok).toBe(true)
  })
})

describe('inbound validation', () => {
  it('rejects malformed payloads without throwing', () => {
    for (const raw of [ 'not json', '', '{', '[1,2,3]', 'null' ]) {
      const result = parseClientMessage(raw)
      expect(result.ok).toBe(false)
    }
  })

  it('rejects an unknown message type', () => {
    expect(parseClientMessage(encoded({ type: 'sudo', drop: 'table' })).ok).toBe(false)
  })

  it('rejects an unknown ship id', () => {
    const join = { type: 'join', protocol: PROTOCOL_VERSION, name: 'x', shipId: '../../etc/passwd' }
    expect(parseClientMessage(encoded(join)).ok).toBe(false)
  })

  it('caps input bundles so replay work stays bounded', () => {
    const frames = Array.from({ length: MAX_INPUT_FRAMES + 1 }, (_, i) => frame(i))
    const packet = { type: 'input', frames, lastAckSnapshot: 0, interpTick: 0 }
    expect(parseClientMessage(encoded(packet)).ok).toBe(false)
  })

  it('rejects an empty input bundle', () => {
    const packet = { type: 'input', frames: [], lastAckSnapshot: 0, interpTick: 0 }
    expect(parseClientMessage(encoded(packet)).ok).toBe(false)
  })

  it('clamps out-of-range axes instead of dropping the packet', () => {
    // A frozen ship is a worse failure than a saturated stick: an over-range
    // axis is treated as full lock so the player keeps flying.
    const packet = { type: 'input', frames: [{ ...frame(1), steer: 900, aimPitch: -42 }], lastAckSnapshot: 0, interpTick: 0 }
    const result = parseClientMessage(encoded(packet))

    expect(result.ok).toBe(true)
    if (result.ok) {
      const [ first ] = (result.message as InputPacket).frames
      expect(first.steer).toBe(1)
      expect(first.aimPitch).toBe(-1)
    }
  })

  it('neutralises an axis that is not a finite number', () => {
    // JSON cannot carry NaN or Infinity, so they arrive as `null`. Axes fall
    // back to neutral rather than failing the packet — same reasoning as the
    // clamp above, and it guarantees rapier never sees a NaN position.
    const packet = '{"type":"input","frames":[{"seq":1,"clientTick":1,"steer":null,"throttle":true,"brake":false,"boost":false,"fire":false,"resetSeq":0}],"lastAckSnapshot":0,"interpTick":0}'
    const result = parseClientMessage(packet)

    expect(result.ok).toBe(true)
    if (result.ok)
      expect((result.message as InputPacket).frames[0].steer).toBe(0)
  })

  it('still fails the packet when a non-axis field is junk', () => {
    // The lenient axis fallback must not extend to structure: a bad `seq` or a
    // missing trigger is a broken client, not a saturated stick.
    const packet = { type: 'input', frames: [{ ...frame(1), seq: 'first' }], lastAckSnapshot: 0, interpTick: 0 }
    expect(parseClientMessage(encoded(packet)).ok).toBe(false)
  })

  it('keeps a name bounded', () => {
    const join = { type: 'join', protocol: PROTOCOL_VERSION, name: 'x'.repeat(500), shipId: 'icaras' }
    expect(parseClientMessage(encoded(join)).ok).toBe(false)
  })
})

describe('toBattleInput', () => {
  it('drops the transport fields the sim has no use for', () => {
    const input = toBattleInput(frame(9))
    expect(input).not.toHaveProperty('seq')
    expect(input).not.toHaveProperty('clientTick')
    expect(input.steer).toBe(0.5)
    expect(input.aimPitch).toBe(0.25)
  })
})

describe('protocol version', () => {
  it('is carried on the join so a stale tab is refused, not silently decoded', () => {
    const join   = { type: 'join', protocol: PROTOCOL_VERSION, name: 'Pilot', shipId: 'icaras' }
    const result = parseClientMessage(encoded(join))

    expect(result.ok).toBe(true)
    if (result.ok)
      expect((result.message as JoinRequest).protocol).toBe(PROTOCOL_VERSION)
  })
})
