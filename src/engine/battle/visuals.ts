import * as THREE from 'three'
import { NEUTRAL_COLOR, TEAM_COLORS } from './arena'
import type { BattleTeam } from './arena'
import { WEAPONS } from './weapons'
import type { WeaponId } from './weapons'


const UP    = new THREE.Vector3(0, 1, 0)
const _a    = new THREE.Vector3()
const _b    = new THREE.Vector3()
const _mid  = new THREE.Vector3()
const _quat = new THREE.Quaternion()

/** HUD-ish overlay pass: never occluded, never tone-mapped, always last. */
const OVERLAY_ORDER = 900

function overlayMaterial (color: THREE.ColorRepresentation, opacity: number): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthTest:   false,
    depthWrite:  false,
    toneMapped:  false,
  })
}

// --- objectives -------------------------------------------------------------

export type ObjectiveVisual = {
  group: THREE.Group;
  update(elapsed: number, carried: boolean): void;
  dispose(): void;
}

/**
 * The capturable core: a three-sided pyramid, not a flag on a pole.
 *
 * `ConeGeometry` with 3 radial segments IS a triangular pyramid — three faces,
 * three edges up the sides — and it reads as an objective from any angle
 * without a billboarded banner that vanishes edge-on. The counter-rotating
 * wire shell is what makes it obviously a pickup rather than scenery.
 */
export function buildObjective (team: BattleTeam): ObjectiveVisual {
  const color = new THREE.Color(TEAM_COLORS[team])
  const group = new THREE.Group()

  const bodyMat = new THREE.MeshStandardMaterial({
    color:             color.clone().multiplyScalar(0.45),
    emissive:          color,
    emissiveIntensity: 1.5,
    metalness:         0.7,
    roughness:         0.25,
    flatShading:       true,
  })
  const body      = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3, 3), bodyMat)
  body.position.y = 1.7
  body.castShadow = true
  group.add(body)

  // Inverted twin below, so the silhouette is a spinning bipyramid.
  const keel      = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.5, 3), bodyMat)
  keel.position.y = -0.55
  keel.rotation.x = Math.PI
  group.add(keel)

  const shellMat = new THREE.MeshBasicMaterial({
    color,
    wireframe:   true,
    transparent: true,
    opacity:     0.4,
    toneMapped:  false,
  })
  const shell      = new THREE.Mesh(new THREE.ConeGeometry(2.6, 5.2, 3), shellMat)
  shell.position.y = 1.6
  group.add(shell)

  const glowMat = new THREE.SpriteMaterial({
    color,
    transparent: true,
    opacity:     0.5,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
    toneMapped:  false,
  })
  const glow = new THREE.Sprite(glowMat)
  glow.scale.set(6, 6, 1)
  glow.position.y = 1.6
  group.add(glow)

  // Short range and modest intensity ON PURPOSE. At 55/90 this light sits right
  // beside a team's spawn and gels the whole opening of a match in team colour —
  // the objective should glow, not tint the camera.
  const beacon      = new THREE.PointLight(color, 14, 34, 2)
  beacon.position.y = 2
  group.add(beacon)

  return {
    group,
    update (elapsed, carried) {
      const spin       = carried ? 3.2 : 1.1
      body.rotation.y  = elapsed * spin
      keel.rotation.y  = elapsed * spin
      shell.rotation.y = -elapsed * spin * 0.55

      const bob        = carried ? 0 : Math.sin(elapsed * 1.6) * 0.35
      body.position.y  = 1.7 + bob
      shell.position.y = 1.6 + bob
      glow.position.y  = 1.6 + bob
      glowMat.opacity  = 0.36 + Math.sin(elapsed * 3) * 0.12
    },
    dispose () {
      body.geometry.dispose()
      keel.geometry.dispose()
      shell.geometry.dispose()
      bodyMat.dispose()
      shellMat.dispose()
      glowMat.dispose()
    },
  }
}

// --- lock-on caret ----------------------------------------------------------

export type CaretMarker = {
  group: THREE.Group;

  /**
   * @param progress - 0..1 acquisition meter.
   * @param locked   - the meter completed; draw the committed state.
   * @param tracked  - this ship is the one the lock is filling against.
   */
  update(camera: THREE.Camera, progress: number, locked: boolean, tracked: boolean, elapsed: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** One corner caret: an L of two segments, in the marker's local XY plane. */
function caretGeometry (): THREE.BufferGeometry {
  const arm = 0.42
  const pts = [
    -1, 1 - arm, 0, -1, 1, 0,
    -1, 1, 0, -1 + arm, 1, 0,
  ]
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return geo
}

/**
 * The in-world lock-on marker: four carets that close in as the lock fills.
 *
 * Billboarded and drawn with `depthTest: false`, so it behaves like a HUD
 * element pinned to a ship rather than geometry that can hide behind a mesa —
 * an occluded target is culled by the sim's line-of-sight test, not by the
 * depth buffer, and hiding the marker there would just look like a bug.
 *
 * Scale is corrected for distance every frame so the caret keeps a constant
 * apparent size: a marker that shrinks to nothing at 300 m is unusable, and
 * 300 m is a normal engagement range on this deck.
 */
export function buildCaretMarker (): CaretMarker {
  const group       = new THREE.Group()
  group.renderOrder = OVERLAY_ORDER
  group.visible     = false

  const caretMat                     = overlayMaterial('#dfe6ff', 0.9)
  const carets: THREE.LineSegments[] = []
  const geo                          = caretGeometry()

  // One geometry, four rotations — the L is authored in the top-left corner.
  for (let i = 0; i < 4; i++) {
    const caret       = new THREE.LineSegments(geo, caretMat)
    caret.rotation.z  = -i * Math.PI / 2
    caret.renderOrder = OVERLAY_ORDER
    group.add(caret)
    carets.push(caret)
  }

  // Acquisition arc: a ring whose swept angle IS the meter.
  const arcMat = new THREE.MeshBasicMaterial({
    color:       '#ffd34d',
    transparent: true,
    opacity:     0.95,
    side:        THREE.DoubleSide,
    depthTest:   false,
    depthWrite:  false,
    toneMapped:  false,
  })
  const arc       = new THREE.Mesh(new THREE.RingGeometry(1.28, 1.46, 40, 1, Math.PI / 2, 0.001), arcMat)
  arc.renderOrder = OVERLAY_ORDER + 1
  group.add(arc)

  // Committed-lock diamond in the centre.
  const diamondMat = overlayMaterial('#ff2d6f', 1)
  const diamondGeo = new THREE.BufferGeometry()
  diamondGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0.34, 0, 0.34, 0, 0,
    0.34, 0, 0, 0, -0.34, 0,
    0, -0.34, 0, -0.34, 0, 0,
    -0.34, 0, 0, 0, 0.34, 0,
  ], 3))

  const diamond       = new THREE.LineSegments(diamondGeo, diamondMat)
  diamond.renderOrder = OVERLAY_ORDER + 1
  group.add(diamond)

  let arcSpan = -1

  return {
    group,

    update (camera, progress, locked, tracked, elapsed) {
      group.quaternion.copy(camera.quaternion)

      // Constant apparent size: scale ∝ distance to the camera.
      _a.setFromMatrixPosition(group.matrixWorld)
      _b.setFromMatrixPosition(camera.matrixWorld)

      const dist = Math.max(_a.distanceTo(_b), 1)
      group.scale.setScalar(dist * 0.035)

      // Carets pull in from 1.9 to 1.0 as the lock fills — the movement is the
      // readable part; the arc is confirmation.
      const spread = locked ? 1 : 1.9 - 0.9 * progress
      for (const caret of carets)
        caret.scale.setScalar(spread)

      const color = locked ? '#ff2d6f' : tracked ? '#ffd34d' : '#9fb0d8'
      caretMat.color.set(color)
      caretMat.opacity = locked ? 1 : tracked ? 0.95 : 0.45

      // Rebuilding the ring every frame would churn buffers at 60 Hz; only redo
      // it when the swept angle actually moved a visible amount.
      const span = Math.max(0.001, progress * Math.PI * 2)
      if (Math.abs(span - arcSpan) > 0.02) {
        arcSpan = span
        arc.geometry.dispose()
        arc.geometry = new THREE.RingGeometry(1.28, 1.46, 40, 1, Math.PI / 2, -span)
      }
      arc.visible     = !locked && progress > 0.02
      arc.scale.setScalar(spread)

      diamond.visible    = locked
      diamondMat.opacity = 0.6 + Math.sin(elapsed * 9) * 0.4
    },

    setVisible (visible) {
      group.visible = visible
    },

    dispose () {
      geo.dispose()
      diamondGeo.dispose()
      arc.geometry.dispose()
      caretMat.dispose()
      arcMat.dispose()
      diamondMat.dispose()
    },
  }
}

// --- beams ------------------------------------------------------------------

export type BeamPool = {
  group: THREE.Group;
  show(index: number, from: THREE.Vector3Like, to: THREE.Vector3Like, weapon: WeaponId, fade: number): void;
  hideFrom(index: number): void;
  dispose(): void;
}

/**
 * Pooled hitscan beams.
 *
 * Two coaxial cylinders per shot — a white-hot core and a wide coloured halo —
 * both additive and `toneMapped: false`, so the bloom pass picks them up
 * without the rest of the arena blowing out. The unit cylinder is built along
 * +Y and rotated onto the shot vector, which is why nothing here rebuilds
 * geometry per frame.
 */
export function buildBeamPool (size: number): BeamPool {
  const group = new THREE.Group()
  const items: Array<{
    root:    THREE.Group;
    core:    THREE.Mesh;
    halo:    THREE.Mesh;
    coreMat: THREE.MeshBasicMaterial;
    haloMat: THREE.MeshBasicMaterial;
  }> = []

  const geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true)

  for (let i = 0; i < size; i++) {
    const coreMat = new THREE.MeshBasicMaterial({
      color:       '#ffffff',
      transparent: true,
      opacity:     1,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      toneMapped:  false,
    })
    const haloMat = new THREE.MeshBasicMaterial({
      color:       '#ffd34d',
      transparent: true,
      opacity:     0.5,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      side:        THREE.DoubleSide,
      toneMapped:  false,
    })

    const root = new THREE.Group()
    const core = new THREE.Mesh(geo, coreMat)
    const halo = new THREE.Mesh(geo, haloMat)
    root.add(core, halo)
    root.visible = false
    group.add(root)
    items.push({ root, core, halo, coreMat, haloMat })
  }

  return {
    group,

    show (index, from, to, weapon, fade) {
      const item = items[index]
      if (!item)
        return

      const spec = WEAPONS[weapon]
      _a.set(from.x, from.y, from.z)
      _b.set(to.x, to.y, to.z)
      _mid.addVectors(_a, _b).multiplyScalar(0.5)

      const dir = _b.sub(_a)
      const len = dir.length()
      if (len < 1e-3) {
        item.root.visible = false
        return
      }
      dir.multiplyScalar(1 / len)
      _quat.setFromUnitVectors(UP, dir)

      const width = spec.beamWidth ?? 0.12
      item.root.position.copy(_mid)
      item.root.quaternion.copy(_quat)
      item.root.visible = true

      item.core.scale.set(width * 0.45, len, width * 0.45)
      item.halo.scale.set(width * 2.4, len, width * 2.4)
      item.coreMat.opacity = fade
      item.haloMat.color.set(spec.color)
      item.haloMat.opacity = fade * 0.55
    },

    hideFrom (index) {
      for (let i = index; i < items.length; i++)
        items[i].root.visible = false
    },

    dispose () {
      geo.dispose()
      for (const item of items) {
        item.coreMat.dispose()
        item.haloMat.dispose()
      }
    },
  }
}

// --- missiles ---------------------------------------------------------------

export type MissilePool = {
  group: THREE.Group;
  show(index: number, position: THREE.Vector3Like, velocity: THREE.Vector3Like, weapon: WeaponId): void;
  hideFrom(index: number): void;
  dispose(): void;
}

/** Pooled warheads: a dart body plus a stretched additive exhaust cone. */
export function buildMissilePool (size: number): MissilePool {
  const group    = new THREE.Group()
  const bodyGeo  = new THREE.ConeGeometry(0.32, 1.9, 6)
  const trailGeo = new THREE.ConeGeometry(0.42, 7, 6, 1, true)

  // Author both along +Y so the same `setFromUnitVectors(UP, dir)` orients them.
  trailGeo.translate(0, -4.2, 0)

  const bodyMat = new THREE.MeshStandardMaterial({
    color:     '#cfd6ff',
    metalness: 0.8,
    roughness: 0.3,
  })

  const items: Array<{ root: THREE.Group; trail: THREE.Mesh; trailMat: THREE.MeshBasicMaterial }> = []

  for (let i = 0; i < size; i++) {
    const trailMat = new THREE.MeshBasicMaterial({
      color:       '#ff8a3d',
      transparent: true,
      opacity:     0.75,
      blending:    THREE.AdditiveBlending,
      depthWrite:  false,
      side:        THREE.DoubleSide,
      toneMapped:  false,
    })

    const root  = new THREE.Group()
    const body  = new THREE.Mesh(bodyGeo, bodyMat)
    const trail = new THREE.Mesh(trailGeo, trailMat)
    root.add(body, trail)
    root.visible = false
    group.add(root)
    items.push({ root, trail, trailMat })
  }

  return {
    group,

    show (index, position, velocity, weapon) {
      const item = items[index]
      if (!item)
        return

      _a.set(velocity.x, velocity.y, velocity.z)

      const speed = _a.length()
      if (speed > 1e-3) {
        _a.multiplyScalar(1 / speed)
        _quat.setFromUnitVectors(UP, _a)
        item.root.quaternion.copy(_quat)
      }
      item.root.position.set(position.x, position.y, position.z)
      item.root.visible = true
      item.trailMat.color.set(WEAPONS[weapon].color)
    },

    hideFrom (index) {
      for (let i = index; i < items.length; i++)
        items[i].root.visible = false
    },

    dispose () {
      bodyGeo.dispose()
      trailGeo.dispose()
      bodyMat.dispose()
      for (const item of items)
        item.trailMat.dispose()
    },
  }
}

// --- control zones ----------------------------------------------------------

export type ZoneVisual = {
  group: THREE.Group;
  update(owner: BattleTeam | null, capturing: BattleTeam | null, progress: number, contested: boolean, elapsed: number): void;
  dispose(): void;
}

/**
 * A control point, drawn as a ring plus a light column.
 *
 * The column exists because the points sit on mesa tops 16 units up and 300
 * units away: without a vertical marker you cannot tell who holds what from
 * your own half of the deck.
 */
export function buildZoneVisual (radius: number): ZoneVisual {
  const group = new THREE.Group()

  const ringMat = new THREE.MeshBasicMaterial({
    color:       NEUTRAL_COLOR,
    transparent: true,
    opacity:     0.75,
    side:        THREE.DoubleSide,
    toneMapped:  false,
  })
  const ring      = new THREE.Mesh(new THREE.RingGeometry(radius * 0.94, radius, 64), ringMat)
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.09
  group.add(ring)

  // Filled disc whose radius IS the capture meter.
  const fillMat = new THREE.MeshBasicMaterial({
    color:       NEUTRAL_COLOR,
    transparent: true,
    opacity:     0.16,
    side:        THREE.DoubleSide,
    toneMapped:  false,
  })
  const fill      = new THREE.Mesh(new THREE.CircleGeometry(radius, 64), fillMat)
  fill.rotation.x = -Math.PI / 2
  fill.position.y = 0.07
  group.add(fill)

  // BackSide, not DoubleSide: an additive tube drawn on both faces stacks two
  // layers of colour everywhere and reads as a solid slab from across the deck.
  const columnMat = new THREE.MeshBasicMaterial({
    color:       NEUTRAL_COLOR,
    transparent: true,
    opacity:     0.07,
    side:        THREE.BackSide,
    depthWrite:  false,
    blending:    THREE.AdditiveBlending,
    toneMapped:  false,
  })
  const column      = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.7, radius * 0.85, 55, 20, 1, true), columnMat)
  column.position.y = 27
  group.add(column)

  return {
    group,

    update (owner, capturing, progress, contested, elapsed) {
      const active = owner ?? capturing
      const color  = active ? TEAM_COLORS[active] : NEUTRAL_COLOR

      ringMat.color.set(color)
      fillMat.color.set(color)
      columnMat.color.set(color)

      fill.scale.setScalar(Math.max(0.001, progress))
      fillMat.opacity = owner ? 0.2 : 0.13

      // Contested points strobe: it is the one zone state a player must notice
      // from the other side of the arena.
      const pulse       = contested ? 0.5 + Math.abs(Math.sin(elapsed * 5)) * 0.5 : 1
      ringMat.opacity   = (owner ? 0.85 : 0.5) * pulse
      columnMat.opacity = (owner ? 0.1 : 0.05) * pulse
    },

    dispose () {
      ring.geometry.dispose()
      fill.geometry.dispose()
      column.geometry.dispose()
      ringMat.dispose()
      fillMat.dispose()
      columnMat.dispose()
    },
  }
}

// --- nameplates -------------------------------------------------------------

export type Nameplate = {
  sprite: THREE.Sprite;
  set(name: string, health: number, maxHealth: number, team: BattleTeam, carrying: boolean): void;
  dispose(): void;
}

/** Canvas-backed name + hull bar floating over a ship. */
export function buildNameplate (): Nameplate {
  const canvas  = document.createElement('canvas')
  canvas.width  = 256
  canvas.height = 64

  const ctx          = canvas.getContext('2d')!
  const texture      = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace

  const material = new THREE.SpriteMaterial({
    map:         texture,
    transparent: true,
    depthTest:   false,
    depthWrite:  false,
    toneMapped:  false,
  })
  const sprite = new THREE.Sprite(material)
  // The hull is ~2.8 units long. An 8-unit plate above it filled the screen
  // whenever a team-mate spawned alongside you.
  sprite.scale.set(4.4, 1.1, 1)
  sprite.position.y  = 3
  sprite.renderOrder = OVERLAY_ORDER

  let last = ''

  return {
    sprite,

    set (name, health, maxHealth, team, carrying) {
      const pct = Math.max(0, Math.min(1, health / (maxHealth || 100)))
      const key = `${name}|${Math.round(pct * 40)}|${team}|${carrying}`
      // Redrawing a canvas and re-uploading the texture every frame for every
      // ship is the expensive way to render four words.
      if (key === last)
        return
      last = key

      ctx.clearRect(0, 0, 256, 64)

      ctx.font         = '600 22px ui-monospace, monospace'
      ctx.textAlign    = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle    = 'rgba(4,6,12,0.55)'
      ctx.fillRect(8, 4, 240, 30)
      ctx.fillStyle    = TEAM_COLORS[team]
      ctx.fillText(carrying ? `▲ ${name}` : name, 128, 19)

      ctx.fillStyle = 'rgba(255,255,255,0.18)'
      ctx.fillRect(8, 40, 240, 10)
      ctx.fillStyle = pct > 0.6 ? '#34d399' : pct > 0.3 ? '#fbbf24' : '#f87171'
      ctx.fillRect(8, 40, 240 * pct, 10)

      texture.needsUpdate = true
    },

    dispose () {
      texture.dispose()
      material.dispose()
    },
  }
}
