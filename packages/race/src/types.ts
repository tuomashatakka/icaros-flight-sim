/**
 * Race's wire and sim types.
 *
 * The shape deliberately mirrors `@crash-velocity/battle`'s: one input record
 * per tick, one snapshot per broadcast, one event list drained per step. Two
 * modes that answer the same shape can share a transport, a prediction loop and
 * an interpolator, which is the whole reason race stopped being a special case.
 */

import type { Transform } from 'Φtypes'
import type { ShipId } from 'Φships'
import type { RaceProgress, RaceStatus } from './rules'


export type RaceInput = {
  steer:    number;
  strafe:   number;
  throttle: boolean;
  brake:    boolean;
  boost:    boolean;
  reverse:  boolean;

  // Held vertical aim axis. Race springs it back to level for the camera; the
  //  sim carries it so the wire format is one shape for both modes.
  aimPitch: number;

  /** Wrapping counter; an increment is a respawn request. */
  resetSeq: number;
}

export const NEUTRAL_RACE_INPUT: RaceInput = {
  steer: 0, strafe: 0, throttle: false, brake: false, boost: false, reverse: false, aimPitch: 0, resetSeq: 0,
}

export type RacerSnapshot = {
  id:     string;
  name:   string;
  shipId: ShipId;
  isBot:  boolean;

  x:  number;
  y:  number;
  z:  number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;

  boost:    number;
  speed:    number;
  grounded: boolean;

  lap:            number;
  nextCheckpoint: number;
  position:       number;
  elapsed:        number;
  lapElapsed:     number;
  bestLap:        number | null;
  finished:       boolean;
  respawnIndex:   number;
}

export type RaceSnapshot = {
  tick:      number;
  status:    RaceStatus;
  countdown: number;
  trackId:   string;
  laps:      number;
  racers:    RacerSnapshot[];
}

export type RaceEvent =
  | { type: 'gate'; id: string; index: number } |
  { type: 'lap'; id: string; lap: number; lapTime: number; best: boolean } |
  { type: 'finish'; id: string; position: number; totalTime: number } |
  { type: 'respawn'; id: string } |
  { type: 'countdown'; value: number } |
  { type: 'raceStart' } |
  { type: 'raceEnd' }

export type { RaceProgress, RaceStatus }
