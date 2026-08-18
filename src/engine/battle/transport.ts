import { useBattleStore } from '@/hooks/use-battle-store'
import { NetBodyInterpolator, NetworkClock } from '../interpolation-network'
import type { BattleTeam } from './arena'
import type { Beam, BattleEvent, BattleSnapshot, BattleStatus } from './sim'
import type { ShipId } from '@/lib/ship/registry'


// The one port this build talks to; the client-side dev tooling uses the same
// default. Kept as a module const so `?sv=` can override in dev without the
// transport knowing about the URL layer.
const DEFAULT_PORT = 9003

/**
 * Server → client protocol, straight off the wire. Hand-typed to mirror
 * server/battle-server.ts' broadcast payloads; importing BattleSnapshot keeps
 * the state packet honest against the sim that produced it.
 */
type ServerMessage =
  | { type: 'queued'; status: BattleStatus } |
  { type: 'joined'; playerId: string; name: string; team: BattleTeam; shipId: ShipId; status: BattleStatus } |
  { type: 'roster'; players: Array<{ id: string; name: string; team: BattleTeam; isBot: boolean; shipId: ShipId; kills?: number; deaths?: number }> } |
  { type: 'state' } & BattleSnapshot |
  { type: 'events'; list: BattleEvent[] } |
  { type: 'error'; message: string }

export type NetPlayer = {
  id:     string;
  team:   BattleTeam;
  name:   string;
  interp: NetBodyInterpolator;
}

export type NetFlag = {
  team: BattleTeam;
  pose: Float64Array;
}

export type NetMissile = { id: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; team: BattleTeam }

/**
 * The battle transport: WebSocket to the authoritative server + the render-side
 * pose buffers.
 *
 * One instance lives for the life of a battle scene. It owns the socket, the
 * 60 Hz input pump, and the per-entity interpolators; the scene reads poses
 * from it each rendered frame. React only ever sees the slim HUD state in
 * `useBattleStore` — remote ship *positions* never trigger a React commit.
 */
type CType = {
  steer:          number;
  throttle:       boolean;
  brake:          boolean;
  boost:          boolean;
  fire:           boolean;
  fireSecondary?: boolean;
  resetSeq:       number;
}

export class BattleTransport {
  readonly clock = new NetworkClock()

  private ws:       WebSocket | null = null
  private playerId: string | null = null
  private input = {
    steer:         0,
    throttle:      false,
    brake:         false,
    boost:         false,
    fire:          false,
    fireSecondary: false,
    resetSeq:      0,
    dirty:         false,
  }

  private frames:   NetPlayer[] = []
  private flags:    Map<BattleTeam, NetFlag> = new Map()
  private beams:    Beam[] = []
  private missiles: NetMissile[] = []
  private statusTally = 0

  /** Most recent snapshot poses, keyed by player id — scene reads these per frame. */
  players (): readonly NetPlayer[] {
    return this.frames
  }

  flagsOf (team: BattleTeam): NetFlag | undefined {
    return this.flags.get(team)
  }

  beamsOf (): readonly Beam[] {
    return this.beams
  }

  missilesOf (): readonly NetMissile[] {
    return this.missiles
  }

  localId (): string | null {
    return this.playerId
  }

  connect (name: string, shipId: string, port = DEFAULT_PORT): void {
    const url = `ws://${globalThis.location?.hostname ?? 'localhost'}:${port}/battle`
    const ws  = new WebSocket(url)
    this.ws   = ws

    useBattleStore.getState().setStatus('connecting')

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', name, shipId }))
    }

    ws.onmessage = ({ data }) => this.route(JSON.parse(String(data)) as ServerMessage)
    ws.onclose   = () => {
      if (this.ws === ws)
        this.teardown()
    }
    ws.onerror   = () => useBattleStore.getState().setStatus('error')
  }

  private route (msg: ServerMessage): void {
    const s = useBattleStore.getState()
    switch (msg.type) {
      case 'queued':
        s.setStatus('queued')
        break
      case 'joined': {
        s.joined({ playerId: msg.playerId, team: msg.team, shipId: msg.shipId, name: msg.name })
        // A join into an active match is not a queue — surface the real sim
        // phase so the HUD skips the "waiting for match" state.
        if (msg.status !== 'lobby' && msg.status !== 'finished')
          s.setStatus(msg.status)
        break
      }
      case 'roster':
        s.setRoster(msg.players.map(p => ({
          id:     p.id,
          name:   p.name,
          team:   p.team,
          isBot:  p.isBot,
          kills:  p.kills ?? 0,
          deaths: p.deaths ?? 0,
        })))
        break
      case 'state':
        this.applySnapshot(msg)
        break
      case 'events':
        for (const e of msg.list)
          s.applyEvent(e)
        break
      case 'error':
        s.setError(msg.message)
        break
    }
  }

  private applySnapshot (snap: BattleSnapshot): void {
    // One React commit per second's worth of states for the roster/HUD chrome;
    // positions themselves live only in the interpolators below.
    this.statusTally++

    // Interpolators: commit each player's pose, creating entries on first sight.
    for (const p of snap.players) {
      let f = this.frames.find(x => x.id === p.id)
      if (!f) {
        f = { id: p.id, team: p.team, name: p.name, interp: new NetBodyInterpolator() }
        this.frames.push(f)
      }
      f.interp.commit(new Float64Array([ p.x, p.y, p.z, p.qx, p.qy, p.qz, p.qw ]))
    }

    // Drop players who left the snapshot.
    const live = new Set(snap.players.map(p => p.id))
    if (this.frames.some(f => !live.has(f.id)))
      this.frames = this.frames.filter(f => live.has(f.id))

    for (const fl of snap.flags) {
      let nf = this.flags.get(fl.team)
      if (!nf) {
        nf = { team: fl.team, pose: new Float64Array(7) }
        this.flags.set(fl.team, nf)
      }
      nf.pose.set([ fl.x, fl.y, fl.z, 0, 0, 0, 1 ])
    }

    this.beams    = snap.beams.map(b => ({ ...b }))
    this.missiles = snap.missiles.map(m => ({ id: m.id, x: m.x, y: m.y, z: m.z, vx: m.vx, vy: m.vy, vz: m.vz, team: m.team }))

    if (this.statusTally % 30 === 0)
      useBattleStore.getState().setChrome({
        status:    snap.status,
        countdown: snap.countdown,
        timeLeft:  snap.timeLeft,
        scores:    snap.scores,
        // The wire carries zone ids, not display names; the HUD falls back to
        // the id until the arena is resolved client-side.
        zones:     snap.zones.map(z => ({ ...z, name: z.id, short: z.id.slice(0, 2).toUpperCase() })),
        flags:     snap.flags.map(fl => ({ team: fl.team, state: fl.state, carrierId: fl.carrierId })),
      })
  }

  /** Feed one game-frame's worth of input; matches the 60 Hz sim cadence. */
  sendInput (): void {
    if (this.input.dirty && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const { steer, throttle, brake, boost, fire, fireSecondary, resetSeq } = this.input
      this.ws.send(JSON.stringify({ type: 'input', steer, throttle, brake, boost, fire, fireSecondary, resetSeq }))
      this.input.dirty = false
    }
  }

  /** Copies the live control surface into the pending packet (once per tick). */
  setControls (c: CType): void {
    this.input.steer         = c.steer
    this.input.throttle      = c.throttle
    this.input.brake         = c.brake
    this.input.boost         = c.boost
    this.input.fire          = c.fire
    this.input.fireSecondary = Boolean(c.fireSecondary)
    this.input.resetSeq      = c.resetSeq
    this.input.dirty         = true
  }

  leave (): void {
    this.ws?.send(JSON.stringify({ type: 'leave' }))
  }

  teardown (): void {
    this.ws       = null
    this.frames   = []
    this.beams    = []
    this.missiles = []
    this.flags.clear()
    useBattleStore.getState().resetSession()
  }
}
