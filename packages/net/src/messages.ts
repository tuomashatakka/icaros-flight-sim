/**
 * The one `MessageKind` every room and the client agree on.
 *
 * It used to be declared three times — once in each room, once in the
 * client's `room-link.ts` — with nothing forcing the three object literals to
 * stay equal, only convention. `Ξ` is the only package all three already
 * depend on (race and battle for the codec, the client transport for the
 * same reason), so it is the one place a changed tag is guaranteed to reach
 * every reader of it at once, rather than two out of three.
 */

export const MessageKind = {
  INPUT:    'i',
  SNAPSHOT: 's',
  EVENTS:   'e',
  PING:     'p',
  PONG:     'q',
} as const

export type MessageKindValue = typeof MessageKind[keyof typeof MessageKind]
