import * as THREE from 'three'
import { TEAM_COLORS } from 'Ψarena'

import { buildCaretMarker, buildNameplate } from './visuals'
import { buildRemoteHull } from '../net/remote-hull'

import type { CaretMarker, Nameplate } from './visuals'
import type { BattleFrame, BattleTransport, NetRemote } from './transport'


/**
 * Opponent hull.
 *
 * Deliberately procedural rather than a loaded ship: a battle can hold a dozen
 * hulls, and the FBX path clones geometry AND textures per instance. This is
 * one draw call's worth of boxes that still reads as a ship at 100 m.
 */
type Opponent = {
  root:      THREE.Group;
  nameplate: Nameplate;
  caret:     CaretMarker;
  seen:      number;
}

export type OpponentsDeps = {
  transport: Pick<BattleTransport, 'renderTimeMs'>;
  camera:    THREE.Camera;
}

export type Opponents = {

  /** Parents for every remote hull and its overlay. `battle.ts` adds these to the scene. */
  shipRoot: THREE.Group;
  overlays: THREE.Group;

  /** Reconcile the map against the latest network view: mount joiners, dispose leavers. */
  sync(view: BattleFrame): void;

  /** Sample every opponent's interpolated pose and push it onto the hull, nameplate and caret. */
  render(elapsed: number): void;

  /** The drawn (interpolated) position of an opponent's hull, for the reticle's hit test. */
  hullPosition(id: string): THREE.Vector3 | undefined;

  dispose(): void;
}

const _pose = new THREE.Vector3()
const _quat = new THREE.Quaternion()

/**
 * Track and draw every remote ship.
 *
 * Every remote is an interpolated transform with no physics: their motion is
 * the server's to decide, and simulating it locally would only produce a
 * second, disagreeing answer.
 */
export function createOpponents (deps: OpponentsDeps): Opponents {
  const opponents = new Map<string, Opponent>()
  const shipRoot  = new THREE.Group()
  const overlays  = new THREE.Group()

  let remoteGeneration           = 0
  let latest: BattleFrame | null = null

  function ensureOpponent (remote: NetRemote): Opponent {
    let entry = opponents.get(remote.id)
    if (entry)
      return entry

    const root      = buildRemoteHull(TEAM_COLORS[remote.team])
    const nameplate = buildNameplate()
    const caret     = buildCaretMarker()
    root.add(nameplate.sprite)
    shipRoot.add(root)
    overlays.add(caret.group)

    entry = { root, nameplate, caret, seen: 0 }
    opponents.set(remote.id, entry)
    return entry
  }

  function dropOpponent (id: string): void {
    const entry = opponents.get(id)
    if (!entry)
      return
    entry.nameplate.dispose()
    entry.caret.dispose()
    entry.root.removeFromParent()
    entry.caret.group.removeFromParent()
    opponents.delete(id)
  }

  return {
    shipRoot,
    overlays,

    sync (view) {
      latest = view
      remoteGeneration++

      for (const remote of view.remotes)
        ensureOpponent(remote).seen = remoteGeneration

      for (const [ id, entry ] of opponents)
        if (entry.seen !== remoteGeneration)
          dropOpponent(id)
    },

    /**
     * Draw every remote ship where the server says it was ~100 ms ago.
     *
     * Rendering the newest pose straight onto a transform is what made a clean
     * 30 Hz stream look like a stuttering one — a remote is only ever drawn
     * from the interpolator, never from a packet.
     */
    render (elapsed) {
      if (!latest)
        return

      const server     = latest.local
      const renderTime = deps.transport.renderTimeMs()

      for (const remote of latest.remotes) {
        const entry = opponents.get(remote.id)
        if (!entry)
          continue

        if (!remote.interp.sampleAt(renderTime, _pose, _quat)) {
          // Nothing buffered yet. (0, 0, 0) is a real place on this map, so an
          // unseen ship is hidden rather than parked at the origin.
          entry.root.visible = false
          entry.caret.setVisible(false)
          continue
        }

        entry.root.visible = true
        entry.root.position.copy(_pose)
        entry.root.quaternion.copy(_quat)

        const carrying = latest.flagsByCarrierId.has(remote.id)
        entry.nameplate.set(remote.name, remote.state.health, remote.state.maxHealth, remote.team, carrying)

        // The caret only ever appears on the ONE ship the local player's lock
        // is working on — a bracket on every enemy is wallpaper, not a target.
        const tracked = Boolean(server) && server?.lockTarget === remote.id && remote.team !== server?.team
        entry.caret.setVisible(tracked && server?.lockPhase !== 'idle')
        if (tracked && server) {
          entry.caret.group.position.set(_pose.x, _pose.y + 1.4, _pose.z)
          entry.caret.group.updateMatrixWorld()
          entry.caret.update(deps.camera, server.lockMeter, server.lockPhase === 'locked', true, elapsed)
        }
      }
    },

    hullPosition (id) {
      return opponents.get(id)?.root.position
    },

    dispose () {
      for (const id of [ ...opponents.keys() ])
        dropOpponent(id)
    },
  }
}
